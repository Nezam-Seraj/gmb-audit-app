import express from "express";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

async function fetchSocialsFromWebsite(url: string): Promise<string[]> {
  if (!url || url === "Not provided" || url === "N/A" || !url.startsWith("http")) return [];
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return [];
    const html = await res.text();
    
    const socialPatterns = [
      /https?:\/\/(?:[a-z0-9-]+\.)?facebook\.com\/[a-zA-Z0-9._-]+/gi,
      /https?:\/\/(?:[a-z0-9-]+\.)?instagram\.com\/[a-zA-Z0-9._-]+/gi,
      /https?:\/\/(?:[a-z0-9-]+\.)?linkedin\.com\/(?:company|in)\/[a-zA-Z0-9._-]+/gi,
      /https?:\/\/(?:[a-z0-9-]+\.)?youtube\.com\/(?:@|channel|user)\/[a-zA-Z0-9._-]+/gi,
      /https?:\/\/(?:[a-z0-9-]+\.)?twitter\.com\/[a-zA-Z0-9._-]+/gi,
      /https?:\/\/(?:[a-z0-9-]+\.)?x\.com\/[a-zA-Z0-9._-]+/gi,
      /https?:\/\/(?:[a-z0-9-]+\.)?pinterest\.com\/[a-zA-Z0-9._-]+/gi,
      /https?:\/\/(?:[a-z0-9-]+\.)?tiktok\.com\/@[a-zA-Z0-9._-]+/gi
    ];
    
    const socials: string[] = [];
    socialPatterns.forEach(pattern => {
      const matches = html.match(pattern);
      if (matches) {
        matches.forEach(match => {
          let cleanUrl = match.trim().replace(/\/$/, "");
          const lower = cleanUrl.toLowerCase();
          if (
            lower.includes("facebook.com/sharer") ||
            lower.includes("facebook.com/share") ||
            lower.includes("linkedin.com/share") ||
            lower.includes("twitter.com/share") ||
            lower.includes("pinterest.com/pin/create") ||
            lower.endsWith("facebook.com/pages") ||
            lower.endsWith("facebook.com/groups")
          ) {
            return;
          }
          if (!socials.includes(cleanUrl)) {
            socials.push(cleanUrl);
          }
        });
      }
    });
    return socials;
  } catch (err) {
    console.error("Error fetching socials from website:", err);
    return [];
  }
}

// Helper to safely obtain GoogleGenAI client
let aiClient: GoogleGenAI | null = null;
function getGeminiClient() {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is not set. Please set it in Settings > Secrets.");
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

const CATEGORY_MAP: Record<string, string> = {
  rehabilitation_center: "Rehabilitation Center",
  dentist: "Dentist",
  dental_clinic: "Dental Clinic",
  medical_clinic: "Medical Clinic",
  hospital: "Hospital",
  physiotherapist: "Physiotherapist",
  doctor: "Doctor",
  alternative_medicine_practitioner: "Alternative Medicine Practitioner",
  mental_health_clinic: "Mental Health Clinic",
  addiction_rehabilitation_center: "Addiction Treatment Center",
  wellness_center: "Wellness Center",
  medical_center: "Medical Center",
  emergency_room: "Emergency Room",
  specialized_clinic: "Specialized Clinic",
  pediatrician: "Pediatrician",
  general_practitioner: "General Practitioner",
  optometrist: "Optometrist",
  chiropractor: "Chiropractor",
  pharmacy: "Pharmacy"
};

const GENERIC_TYPES = new Set([
  "health",
  "point_of_interest",
  "establishment",
  "place_of_worship",
  "government_office",
  "local_government_office",
  "community_center",
  "non_governmental_organization"
]);

function mapTypeToCategory(type: string): string {
  if (CATEGORY_MAP[type]) {
    return CATEGORY_MAP[type];
  }
  // Fallback: convert snake_case to Title Case
  return type
    .split("_")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function getFormattedCategories(place: any) {
  const primaryRaw = place.primaryType || "";
  const typesRaw = place.types || [];
  
  let primaryMapped = "";
  if (place.primaryTypeDisplayName?.text) {
    primaryMapped = place.primaryTypeDisplayName.text;
  } else if (primaryRaw) {
    primaryMapped = mapTypeToCategory(primaryRaw);
  }
  
  const secondaryMapped: string[] = [];
  typesRaw.forEach((t: string) => {
    if (GENERIC_TYPES.has(t)) return;
    const mapped = mapTypeToCategory(t);
    if (primaryMapped && mapped.toLowerCase() === primaryMapped.toLowerCase()) return;
    if (!secondaryMapped.includes(mapped)) {
      secondaryMapped.push(mapped);
    }
  });

  return {
    primary: primaryMapped || "Unknown",
    secondary: secondaryMapped
  };
}

function getCategoryHints(businessName: string, query: string): string[] {
  const nameAndQuery = `${businessName} ${query}`.toLowerCase();
  const hints: string[] = [];
  
  if (/\b(addiction|rehab|detox|substance|recovery|sober|treatment|mountainside)\b/.test(nameAndQuery)) {
    hints.push("Addiction Treatment Center", "Rehabilitation Center", "Alcoholism Treatment Program", "Mental Health Service");
  }
  if (/\b(alcohol|alcoholism)\b/.test(nameAndQuery)) {
    hints.push("Alcoholism Treatment Program", "Addiction Treatment Center");
  }
  if (/\b(dentist|dental|orthodontist|teeth)\b/.test(nameAndQuery)) {
    hints.push("Dentist", "Dental Clinic");
  }
  if (/\b(mental|psychiatr|therapist|counseling|psycholog|behavioral)\b/.test(nameAndQuery)) {
    hints.push("Mental Health Service", "Mental Health Clinic", "Psychotherapist");
  }
  if (/\b(chiropract|back pain)\b/.test(nameAndQuery)) {
    hints.push("Chiropractor");
  }
  
  return Array.from(new Set(hints));
}

function extractCityState(address?: string, serviceLocation?: string): string {
  if (address) {
    const cleanAddress = address.replace(/,\s*(USA|United States)$/i, "").trim();
    const parts = cleanAddress.split(",").map(p => p.trim());
    if (parts.length >= 2) {
      const statePart = parts[parts.length - 1];
      const cityPart = parts[parts.length - 2];
      const stateZipMatch = statePart.match(/^([A-Za-z]{2}|[A-Za-z\s]+)(?:\s+\d{5}(?:-\d{4})?)?$/);
      if (stateZipMatch) {
        const state = stateZipMatch[1].trim();
        if (cityPart && !/^\d+/.test(cityPart)) {
          return `${cityPart}, ${state}`;
        }
      }
    }
    const fallbackMatch = cleanAddress.match(/([^,]+),\s*([A-Za-z]{2})(?:\s+\d{5})?$/);
    if (fallbackMatch) {
      return `${fallbackMatch[1].trim()}, ${fallbackMatch[2].trim()}`;
    }
  }

  if (serviceLocation) {
    return serviceLocation.trim();
  }

  return "";
}

// 1. Audit Endpoint
app.post("/api/audit", async (req, res) => {
  try {
    const { url, businessName, serviceLocation } = req.body;

    if (!url && !businessName && !serviceLocation) {
      return res.status(400).json({ error: "Either a Google Business Profile URL, Business Name, or a Service/Location keywords are required." });
    }

    let detectedLocation = serviceLocation ? serviceLocation.trim() : "";
    let placeReviewCount: number | string = "Not available from Places API";
    let placeReviewVelocity = "Not available from Places API";
    let extractedPlaceId = "";

    const client = getGeminiClient();

    let expandedUrl = url;
    if (url && (url.includes('goo.gl') || url.includes('g.page'))) {
      try {
        const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
        if (response.url) {
          expandedUrl = response.url;
        }
      } catch (e) {
        console.error("Error expanding short URL:", e);
      }
    }

    // Extract name and coordinates from the URL if possible
    let extractedName = "";
    let coordinates: { lat: number, lng: number } | null = null;

    if (expandedUrl) {
      // 1. Coordinates Extraction: Look for @lat,lng
      const coordMatch = expandedUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (coordMatch) {
        coordinates = {
          lat: parseFloat(coordMatch[1]),
          lng: parseFloat(coordMatch[2])
        };
      } else {
        // Also look for query parameters: ll=lat,lng or q=lat,lng
        const queryCoordMatch = expandedUrl.match(/[?&](ll|q)=(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (queryCoordMatch) {
          coordinates = {
            lat: parseFloat(queryCoordMatch[2]),
            lng: parseFloat(queryCoordMatch[3])
          };
        }
      }

      // 2. Name Extraction
      // Try path-based matching (e.g., /place/Business+Name/...)
      const placeMatch = expandedUrl.match(/\/place\/([^\/]+)/);
      if (placeMatch) {
        // Splitting by @ or / in case coordinates/params are attached
        const namePart = placeMatch[1].split('@')[0].split('/')[0];
        extractedName = decodeURIComponent(namePart.replace(/\+/g, ' ')).trim();
      } else {
        // Try query parameter based matching (e.g., ?q=Business+Name)
        const qMatch = expandedUrl.match(/[?&]q=([^&]+)/);
        if (qMatch) {
          extractedName = decodeURIComponent(qMatch[1].replace(/\+/g, ' ')).trim();
        }
      }
    }

    // Determine query target and query string
    let searchTarget = "";
    let googleMapsQuery = "";
    const finalBusinessName = businessName || extractedName;

    if (expandedUrl && finalBusinessName) {
      searchTarget = `the Google Business Profile for "${finalBusinessName}" located at the listing URL: "${expandedUrl}"`;
      googleMapsQuery = finalBusinessName;
    } else if (expandedUrl) {
      searchTarget = `the Google Business Profile listing URL: "${expandedUrl}"`;
      googleMapsQuery = expandedUrl;
    } else if (businessName && serviceLocation) {
      searchTarget = `the Business Name: "${businessName}" serving for "${serviceLocation}"`;
      googleMapsQuery = `${businessName} in ${serviceLocation}`;
    } else if (businessName) {
      searchTarget = `the Business Name: "${businessName}"`;
      googleMapsQuery = businessName;
    } else if (serviceLocation) {
      searchTarget = `the top Google Business Profile matching the keywords: "${serviceLocation}"`;
      googleMapsQuery = serviceLocation;
    }

    let placesApiStatus: "success" | "no_results" | "api_error" | "missing_key" = "missing_key";
    let placesApiContext = "";
    let mapLocationRef = null;

    if (process.env.GOOGLE_MAPS_PLATFORM_KEY) {
      if (googleMapsQuery) {
        try {
          const body: any = {
            textQuery: googleMapsQuery,
            languageCode: "en"
          };

          if (coordinates) {
            body.locationBias = {
              circle: {
                center: {
                  latitude: coordinates.lat,
                  longitude: coordinates.lng
                },
                radius: 5000.0 // 5km radius bias
              }
            };
          }

          const placesRes = await fetch("https://places.googleapis.com/v1/places:searchText", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": process.env.GOOGLE_MAPS_PLATFORM_KEY,
              "X-Goog-FieldMask": "places.id,places.name,places.displayName,places.rating,places.userRatingCount,places.location,places.primaryType,places.primaryTypeDisplayName,places.types,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.regularOpeningHours,places.reviews"
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(5000)
          });

          if (placesRes.ok) {
            const placesData = await placesRes.json();
            if (placesData.places && placesData.places.length > 0) {
              placesApiStatus = "success";
              const place = placesData.places[0];
              const extracted = extractCityState(place.formattedAddress, serviceLocation);
              if (extracted) {
                detectedLocation = extracted;
              }
              if (place.location && typeof place.location.latitude === 'number') {
                mapLocationRef = {
                  lat: place.location.latitude,
                  lng: place.location.longitude
                };
              }

              if (place.id) {
                extractedPlaceId = place.id;
              } else if (place.name && place.name.startsWith("places/")) {
                extractedPlaceId = place.name.substring("places/".length);
              }

              let crawledSocials: string[] = [];
              if (place.websiteUri) {
                try {
                  crawledSocials = await fetchSocialsFromWebsite(place.websiteUri);
                } catch (e) {
                  console.error("Failed to crawl website socials:", e);
                }
              }

              const reviews = place.reviews || [];
              const now = new Date();
              const hundredEightyDaysAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
              let reviewsInLast180Days = 0;
              reviews.forEach((r: any) => {
                if (r.publishTime) {
                  const pubDate = new Date(r.publishTime);
                  if (pubDate >= hundredEightyDaysAgo) {
                    reviewsInLast180Days++;
                  }
                }
              });
              const calculatedVelocity = `${reviewsInLast180Days} reviews in the last 180 days`;
              placeReviewCount = place.userRatingCount || 0;
              placeReviewVelocity = calculatedVelocity;

              const formattedCats = getFormattedCategories(place);
              const categoryHints = getCategoryHints(finalBusinessName, googleMapsQuery);
              const hoursText = place.regularOpeningHours?.weekdayDescriptions
                ? place.regularOpeningHours.weekdayDescriptions.join(", ")
                : "Not provided";
              placesApiContext = `
[CRITICAL GOOGLE PLACES API REAL-TIME DATA INJECTION]
The following data was fetched LIVE from the Google Maps Places API. You MUST treat the name, review count, rating, address, phone number, and opening hours as absolute truth over grounded cached results:
- Real Business Name: ${place.displayName?.text || "Unknown"}
- EXACT Real Total Review Count: ${place.userRatingCount || 0}
- EXACT Real Star Rating: ${place.rating || 0}
- Formatted Address: ${place.formattedAddress || "Unknown"}
- Website URL: ${place.websiteUri || "Not provided"}
- Phone Number: ${place.nationalPhoneNumber || "Not provided"}
- EXACT Real Opening Hours: ${hoursText}
- Real Review Velocity Baseline (from Place API recent reviews): ${calculatedVelocity} (Verify and refine this using search grounding if needed)
- Place ID: ${extractedPlaceId || "Unknown"}
- Website Social Profiles Found on Homepage Crawl: ${crawledSocials.join(", ") || "None"} (Use these profiles as baseline active socials, check if they are linked or displaying correctly on the business's public GMB listing, and check for any other active socials).

[GOOGLE PLACES API CATEGORIES - REFERENCE ONLY]
The following categories are broad, developer-facing Google Places API types. They are NOT the specific merchant-facing Google Business Profile categories. You MUST use Search Grounding to verify and override these with the actual merchant-facing categories from the business's public listing:
- Primary Category (Mapped Place Type): ${formattedCats.primary}
- Associated Secondary Categories (Mapped Place Types): ${formattedCats.secondary.join(", ") || "None"}
- Target Category Hints (Based on Business/Query Keywords): ${categoryHints.join(", ") || "None"}
[END DATA INJECTION]
`;
            } else {
              placesApiStatus = "no_results";
            }
          } else {
            console.error("Places API HTTP Error:", placesRes.status, await placesRes.text().catch(() => ""));
            placesApiStatus = "api_error";
          }
        } catch (err) {
          console.error("Error fetching from Google Maps Places API:", err);
          placesApiStatus = "api_error";
        }
      } else {
        placesApiStatus = "no_results";
      }
    } else {
      placesApiStatus = "missing_key";
    }

    let competitorApiContext = "";
    if (process.env.GOOGLE_MAPS_PLATFORM_KEY && serviceLocation) {
      try {
        const compBody: any = {
          textQuery: serviceLocation,
          languageCode: "en"
        };

        if (coordinates) {
          compBody.locationBias = {
            circle: {
              center: {
                latitude: coordinates.lat,
                longitude: coordinates.lng
              },
              radius: 5000.0
            }
          };
        }

        const compRes = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": process.env.GOOGLE_MAPS_PLATFORM_KEY,
            "X-Goog-FieldMask": "places.id,places.name,places.displayName,places.rating,places.userRatingCount,places.primaryType,places.primaryTypeDisplayName,places.types,places.formattedAddress,places.reviews"
          },
          body: JSON.stringify(compBody),
          signal: AbortSignal.timeout(5000)
        });

        if (compRes.ok) {
          const compData = await compRes.json();
          if (compData.places && compData.places.length > 0) {
            const compList = compData.places.slice(0, 5);
            let compText = "";
            const now = new Date();
            const hundredEightyDaysAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
            
            compList.forEach((place: any, index: number) => {
              const formattedCats = getFormattedCategories(place);
              
              // Calculate competitor review velocity from place.reviews
              const reviews = place.reviews || [];
              let reviewsInLast180Days = 0;
              reviews.forEach((r: any) => {
                if (r.publishTime) {
                  const pubDate = new Date(r.publishTime);
                  if (pubDate >= hundredEightyDaysAgo) {
                    reviewsInLast180Days++;
                  }
                }
              });
              const compVelocity = `${reviewsInLast180Days} reviews in the last 180 days`;
              
              compText += `Competitor ${index + 1}:
- Name: ${place.displayName?.text || "Unknown"}
- EXACT Real Star Rating: ${place.rating || 0}
- EXACT Real Review Count: ${place.userRatingCount || 0}
- Address: ${place.formattedAddress || "Unknown"}
- Primary Category: ${formattedCats.primary}
- Mapped Secondary Categories: ${formattedCats.secondary.join(", ") || "None"}
- Review Velocity Baseline: ${compVelocity} (Do NOT search the web for competitor velocity; use this baseline count to report velocity directly)
`;
            });

            competitorApiContext = `
[CRITICAL GOOGLE PLACES API REAL-TIME COMPETITOR DATA INJECTION]
The following competitors were found by searching for the serviceLocation keyword "${serviceLocation}" using the Google Places API. You MUST treat the name, rating, review count, mapped categories, and review velocity baseline of these top competitors as absolute truth over grounded cached results when evaluating competitors:
${compText}
[END COMPETITOR DATA INJECTION]
`;
          }
        }
      } catch (err) {
        console.error("Error fetching competitor data from Google Maps Places API:", err);
      }
    }

    const competitorPrompt = serviceLocation 
      ? `\nAdditionally, use the provided Service & City keyword ("${serviceLocation}") to identify the real, live top 5 ranking competitors in the local search results on Google Maps. CRITICAL: DO NOT HALLUCINATE COMPETITORS. Only use real businesses that actually exist and rank for this keyword. Compare them against the primary business and provide your analysis in the "competitors" JSON array. CRITICAL: You MUST return exactly 5 competitors in the "competitors" array without any truncation, omitting none, and ensuring exactly 5 items are populated in the JSON output. Pay special attention to these local ranking factors:
1. Business Name: Are they adding keywords into their actual name? (Keyword stuffing in the title). If competitors are doing it, it's a massive ranking factor and the primary business is at a disadvantage. Adding keywords to the primary business name for parity would be a ranking boost, but could lead to profile suspension. This must be presented as an informed decision.
2. Categories: What is their primary category? CRITICAL: You MUST use the mapped competitor categories injected in the [CRITICAL GOOGLE PLACES API REAL-TIME COMPETITOR DATA INJECTION] section as the absolute truth. Do NOT perform web searches for competitor categories. Enforce strict matching to official Google My Business categories (such as "Addiction Treatment Center", "Alcoholism Treatment Program", "Mental Health Service") and prohibit fake category names.
3. Review Velocity: Use the "Review Velocity Baseline" injected for each competitor in the [CRITICAL GOOGLE PLACES API REAL-TIME COMPETITOR DATA INJECTION] section as the absolute truth. Do NOT perform web searches to calculate competitor review velocity; strictly use the baseline counts provided (e.g., 'X reviews in the last 180 days').` 
      : "";

    let sourceSpecificInstructions = "";
    if (placesApiStatus === "success") {
      sourceSpecificInstructions = `
CRITICAL INTEGRITY INSTRUCTION:
1. For reviews and ratings, you MUST use the exact numbers provided in the [CRITICAL GOOGLE PLACES API REAL-TIME DATA INJECTION] section (e.g. EXACT Real Total Review Count and EXACT Real Star Rating). Do NOT search the web to override or change these two numbers.
2. For Website URL, Phone Number, and Formatted Address, use the values from the Places API injection. However, please explain in your audit that the Google Places API \`websiteUri\` lacks UTM parameters. You MUST use Search Grounding to check the live Google Maps profile's website button link (e.g., "?utm_source=google" or "?utm_source=gmb" or similar) for UTM tracking parameters. This audit MUST be highly accurate based on actual website button link checks.
3. For Categories (Primary and Secondary), you MUST use Google Search Grounding to identify the full, complete list of actual active GMB categories (such as Counselor, Halfway house, Alcoholism treatment program, Family counselor, Drug testing service, Mental health clinic, Mental health service, Rehabilitation center, etc.) visible on the public listing. The developer-facing Places API types provided in the injection are broad and incomplete baselines; do NOT restrict your audit to them. Search Google for "[Business Name] Google Maps categories" or look at the GMB Knowledge Panel to verify and compile a complete list of all active categories. Enforce official GMB categories and never report fake names or generic developer types like 'health' or 'medical_clinic'.
`;
    } else {
      const categoryHints = getCategoryHints(finalBusinessName, googleMapsQuery);
      const hintsText = categoryHints.length > 0 ? `Target Category Hints (Based on Business/Query Keywords): ${categoryHints.join(", ")}` : "";
      sourceSpecificInstructions = `
CRITICAL SEARCH GROUNDING INSTRUCTION: Google Places API real-time data is NOT available (status: ${placesApiStatus}). You MUST use Search Grounding to locate the exact business profile on Google Search and Google Maps. Search Grounding often returns heavily cached, outdated, or mixed-source review numbers. You MUST prioritize the HIGHEST Google Review count you can confidently verify from recent search snippets, and avoid including Yelp or Facebook review counts. For the Website URL, use search grounding to check the live Google Maps profile's website button link and check if it contains a UTM tracking parameter (e.g., "?utm_source=google" or "?utm_source=gmb" or similar). Explain that Google Places API \`websiteUri\` lacks UTM parameters and you must check the live Maps profile's website button link using Search Grounding. This check MUST be highly accurate based on the actual website button link.
For Categories (Primary and Secondary), you MUST use Google Search Grounding (e.g., search "[Business Name] Google Maps categories" or analyze the Knowledge Panel) to identify the complete list of actual active primary and secondary GMB categories (such as Counselor, Halfway house, Alcoholism treatment program, Family counselor, Drug testing service, Mental health clinic, Mental health service, Rehabilitation center, etc.) visible on the profile. Do not report fake category names or generic developer types like 'health' or 'medical_clinic'; strictly report official GMB categories.
${hintsText}
`;
    }

    if (!detectedLocation) {
      detectedLocation = "Canaan, CT";
    }
    const detectedCity = detectedLocation.split(",")[0].trim();

    const prompt = `You are an expert consultant in Local SEO and Google Business Profile optimization. (The tool is called "Circle Social GBP Auditor", but "Circle Social" is NOT the name of the business you are auditing).
Your goal is to analyze the following target: ${searchTarget}.
${placesApiContext}
${competitorApiContext}
${competitorPrompt}

[PRIMARY BUSINESS KEY METRICS]
- Review Count: ${placeReviewCount}
- Review Velocity: ${placeReviewVelocity}
CRITICAL: You MUST use the injected Review Count and Review Velocity if they are available (not "Not available from Places API"). If they are "Not available from Places API", you MUST use search grounding to locate the business listing, retrieve the exact review count, and calculate the review velocity (number of reviews in the last 180 days) for the primary business. You MUST return these exact metrics in the "businessDetails" JSON object under "reviewCount" and "reviewVelocity" (reviewCount must be an integer, reviewVelocity must be a string like 'X reviews in the last 180 days').

${sourceSpecificInstructions}

[STANDARD GBP SERVICES REFERENCE TAXONOMY]
For the categories "Addiction Treatment Center", "Mental Health Service", and "Alcoholism Treatment Program", the official, standard pre-defined GBP services are:
- Addiction Treatment Center:
  * "Drug Rehabilitation"
  * "Alcohol Rehabilitation"
  * "Detoxification"
  * "Intensive Outpatient Program"
  * "Outpatient Addiction Treatment"
  * "Medication-Assisted Treatment"
  * "Substance Abuse Counseling"
  * "Residential Treatment"
  * "Partial Hospitalization Program"
  * "Dual Diagnosis Treatment"
  * "Aftercare Support"
  * "Sober Living"
- Mental Health Service:
  * "Mental Health Treatment"
  * "Psychiatric Evaluation"
  * "Cognitive Behavioral Therapy"
  * "Dialectical Behavior Therapy"
  * "Depression Treatment"
  * "Anxiety Treatment"
  * "Trauma Therapy"
  * "Medication Management"
  * "Outpatient Mental Health Care"
  * "Psychotherapy"
  * "Telehealth Sessions"
- Alcoholism Treatment Program:
  * "Alcoholism Treatment"
  * "Alcohol Detoxification"
  * "Alcohol Counseling"
  * "Outpatient Alcohol Rehab"
  * "Residential Alcohol Treatment"
  * "Relapse Prevention Planning"
  * "Support Groups"
[END TAXONOMY]

CRITICAL INSTRUCTION: You MUST correctly identify the actual business name from the provided target. Do NOT output "Circle Social" or "Circle Social Inc" as the audited business name.
CRITICAL INSTRUCTION: When reporting Categories (Primary and Secondary), you MUST identify the complete list of actual active primary and secondary categories on the profile. You are strictly prohibited from using fake, fabricated, or informal category names (e.g., "Addiction Recovery Service" or "Detox Center" are NOT official categories). DO NOT hallucinate, guess, or make up category titles. Do NOT report generic developer types like 'health', 'point_of_interest', 'medical_clinic', or 'establishment' as categories. Proactively use Search Grounding (e.g., searching for "[Business Name] categories" or "[Business Name] Google Maps listing categories") to locate the actual merchant-facing categories displayed on Google Search and Google Maps (e.g. Counselor, Halfway house, Alcoholism treatment program, Family counselor, Drug testing service, Mental health clinic, Mental health service, Rehabilitation center, etc.) for the primary business. For competitors, use the provided mapped categories in the competitor injection section directly without performing search grounding for them. List all categories that are active.
CRITICAL INSTRUCTION: When auditing "Secondary categories" for the primary business, you MUST advise the user in the recommendation text to verify their secondary categories (such as 'Alcoholism Treatment Program', 'Mental Health Service', or 'Rehabilitation Center') by logging into their Google Business Profile dashboard. Explain that secondary categories are often hidden or restricted from standard public search snippets and Google Places API developer fields, so verifying them directly inside the GBP dashboard is a critical best practice. Ensure that you never report fake category names or generic developer types like 'health' or 'medical_clinic' as categories.
CRITICAL INSTRUCTION: When checking review velocity for both the primary business and each competitor, you MUST enforce numerical velocity estimates for the last 180 days (e.g., "15 reviews in the last 180 days", or "0 reviews in the last 180 days" if none are found). Prohibit generic text or omissions.
CRITICAL INSTRUCTION: When auditing "Hours vs competitors", you MUST use the injected "EXACT Real Opening Hours" value (when status is success) as the absolute truth for the business hours of the primary business. Specify the exact business hours in the audit text (e.g., "Open 24 hours" or "Monday - Friday: 9 AM - 5 PM").
CRITICAL INSTRUCTION: When auditing "Google Posts activity", you MUST enforce live grounding searches using search grounding to verify updates, specify the exact date and topic of the most recent post, and you are strictly prohibited from copying placeholder examples (such as "June 12th regarding community outreach") as a fallback or placeholder. If no posts are found, rate the status as "Missing" and state clearly that there are no posts on the profile.
CRITICAL INSTRUCTION: When auditing "Social Profiles", you MUST check the business's public GMB listing, confirm which social profiles are active (by running targeted search queries e.g., searching specifically for "[Business Name] Facebook", "[Business Name] Instagram", "[Business Name] LinkedIn", etc. to verify their active status), explicitly state if they display in the GMB listing, and explicitly list which of the major 7 socials (Facebook, Instagram, YouTube, LinkedIn, TikTok, Twitter/X, Pinterest) are missing from the listing.
CRITICAL INSTRUCTION: When evaluating "Website URL", you MUST perform a highly accurate search grounding check specifically on the live Google Maps profile's website button link to see if it contains UTM tracking parameters (e.g., "?utm_source=google" or "?utm_source=gmb" or similar). Explain that Google Places API \`websiteUri\` lacks UTM parameters and you must check the live Maps profile's website button link using Search Grounding. Do NOT just guess or check the root domain; you must verify the exact target URL of the website button on the live listing. If the website button link does not contain any UTM parameters, you MUST mark this as a negative finding (Needs Improvement or Missing) and recommend adding UTM parameters.
CRITICAL INSTRUCTION: When evaluating and extracting "Services" for "businessDetails.services", you MUST perform highly targeted search grounding queries (such as "[Business Name] Google Maps services" or "[Business Name] services list") to extract the services list from the public GMB profile/location page.
You are STRICKLY FORBIDDEN from dump-listing or returning the entire standard reference taxonomy. You MUST strictly list only the actual, specific services verified as active on the business's public Google Business Profile or maps search snippets.
If the active categories for the business include "Addiction Treatment Center", "Mental Health Service", or "Alcoholism Treatment Program", you MUST strictly map search findings to the provided [STANDARD GBP SERVICES REFERENCE TAXONOMY] and append the dynamic location modifier (either "in ${detectedCity}" or "in ${detectedLocation}"). For example, if the audited business is in ${detectedLocation}, the retrieved services must match the exact naming convention including the suffix (e.g., "Drug Rehabilitation in ${detectedCity}" or "Drug Rehabilitation in ${detectedLocation}").
You MUST strictly exclude/filter out crawl noise, website-specific programs, or generic therapies (such as Reiki, Yoga, Art Therapy, Music Therapy, Alumni Services, Experiential Therapy, Individual/Group/Family/Couples Therapy, Acupuncture, etc.). Only standard predefined services from the taxonomy with the location modifier should be included for these categories.
You are strictly prohibited from stripping location names, and you MUST avoid generic guesses, assumptions, or placeholder listings, ensuring a 1:1 match of the actual services list currently offered on the public GMB profile.
You MUST strictly avoid hallucinating services that are not listed on the public GMB profile. If zero specific services are found or verified on the profile, you MUST NOT list all or a large number of taxonomy items; instead, limit the fallback list to exactly 1-2 primary services matching the business's core category (e.g., "Drug Rehabilitation in ${detectedCity}" or "Mental Health Clinic in ${detectedCity}").
You MUST strictly ignore directory sites (such as PsychologyToday, StartYourRecovery, Rehabs.com, etc.) for compiling the businessDetails.services list, focusing strictly on Google My Business / Google Maps search snippet or knowledge panel information.
CRITICAL INSTRUCTION: You MUST populate the "businessDetails" object in the JSON response containing the primary business's details: "name", "address" (full formatted address), "phone", "websiteUrl" (the exact website URL), "reviewCount" (the total number of reviews, which must be a number), "reviewVelocity" (a numerical velocity string targeting the last 180 days, e.g., '12 reviews in the last 180 days'), "services" (string array containing the mapped services based on the provided taxonomy and location modifiers, e.g., "Drug Rehabilitation in ${detectedCity}" or "Drug Rehabilitation in ${detectedLocation}", while strictly excluding crawl noise and generic therapies like Reiki, Yoga, Art/Music/Experiential Therapy, Alumni Services, Experiential Therapy, Individual/Group/Family Therapy, and Acupuncture, and ignoring directory sites), "socials" (string array of active social media profile links found), and "servicesSource" (string explaining the sourcing of the services, specifically GMB listing snippets vs website crawl due to snippet limitations).


Search Grounding is highly active and encouraged: You MUST search live Google search results, Google Maps, and other public listing sources using search grounding to retrieve the business description, evaluate photos/videos (exterior, interior, team), analyze Google Posts activity, check review replies (reply rate), and find social media links. CRITICAL: For social profiles, you MUST run targeted search queries (e.g., "[Business Name] Facebook", "[Business Name] Instagram", "[Business Name] LinkedIn") using search grounding to verify the business's presence and check if they display in the Google My Business knowledge panel. Perform thorough, in-depth searches to gather real details and write specific, detailed analyses for the primary business and competitors. Avoid writing generic, placeholder, or bland statements.

Conduct a rigorous audit against the following tiered criteria (Scores sum to 118 max, then MUST be normalized down to a 0-100 overall score). Assign each criteria below to either the "Ranking Factor" or "Best Practice" category as instructed:

**Tier 1 — Highest impact**
1. Business name competitive analysis: (Category: Ranking Factor, Weight: 15pts) - Detect keyword stuffing in the name. If competitors are stuffing keywords and the primary business is not, flag it as a risk/disadvantage. State that adding keywords for a ranking boost carries a risk of profile suspension (an informed decision must be made).
2. Primary category match: (Category: Ranking Factor, Weight: 15pts) - Identify its Primary category. Does it perfectly match what is ranking locally for the service?
3. Review velocity vs competitors: (Category: Ranking Factor, Weight: 12pts) - Enforce numerical review velocity estimates for the last 180 days (e.g., '15 reviews in the last 180 days', or '0 reviews in the last 180 days' if none are found) for both the primary business and each competitor. Prohibit generic text or omissions. BE CONSERVATIVE and do not over-estimate or hallucinate exact numbers without evidence. How does their velocity compare to the top competitors?

**Tier 2 — Strong signals**
4. Secondary categories gap analysis: (Category: Ranking Factor, Weight: 10pts) - Are they missing critical secondary categories that top ranking competitors use? CRITICAL: DO NOT hallucinate secondary categories if they are not explicitly present. Only list gaps you are certain of.
5. Services listed: (Category: Ranking Factor, Weight: 9pts) - Are their services comprehensive and include city modifiers? CRITICAL: Closely read the actual service descriptions for city names before claiming they are missing.
6. Business description: (Category: Best Practice, Weight: 8pts) - Evaluate character count vs 750 max, and presence of robust Unique Selling Proposition (USP) and search term optimization.
7. Photos & media: (Category: Best Practice, Weight: 7pts) - Check the presence, recency, and variety of Photos/Videos (Team, Interior, Exterior).

**Tier 3 — Supporting signals**
8. Review quantity & recency: (Category: Ranking Factor, Weight: 6pts) - Total volume and how fresh the latest reviews are.
9. Review reply rate: (Category: Best Practice, Weight: 6pts) - Are they replying to reviews, especially negative ones?
10. Hours vs competitors: (Category: Best Practice, Weight: 5pts) - Are their hours competitive?
11. Website URL: (Category: Best Practice, Weight: 4pts) - Is the website linked? CRITICAL: Check specifically if the live Google Maps profile's website button link utilizes a UTM tracking parameter (e.g., ?utm_source=google... on the main website button). Google Places API \`websiteUri\` lacks UTM parameters, so you must check the live Maps profile's website button link using Search Grounding. Having no UTM parameters on the website button is a penalty.
12. Phone number: (Category: Best Practice, Weight: 4pts) - Clarity and consistency.
13. Address & service area: (Category: Best Practice, Weight: 4pts) - NAP consistency and valid service areas.

**Tier 4 — Completeness / Risk flags**
14. Google Posts activity: (Category: Best Practice, Weight: 3pts) - Activity within the last 7-30 days.
15. Products (Risk flag): (Category: Best Practice, Weight: 3pts) - Note: For treatment centers, Products shouldn't really be used. If they are used, note it as a detriment and flag that they should be removed. (If not used, give 3 pts).
16. Attributes & highlights: (Category: Best Practice, Weight: 3pts) - Use of relevant attributes (e.g., wheelchair accessible, amenities).
17. Social Profiles: (Category: Best Practice, Weight: 4pts) - Check the GMB listing, confirm active ones, and check if major social media profiles are linked and displaying correctly on the Google My Business knowledge panel. You MUST explicitly state if they display in the GMB listing, and you MUST explicitly list which of the major 7 socials (Facebook, Instagram, YouTube, LinkedIn, TikTok, Twitter/X, Pinterest) are missing from the listing.

Be educational, extremely professional, realistic, and highly encouraging. Write of actionable items the business owner can take today.
If you cannot find exact details for specific attributes because they are hidden or the business lacks them, rate them objectively as "Improvement needed" or "Missing" and offer clear constructive advice. Do not synthesize unrealistic content.

CRITICAL: Your response MUST be ONLY valid JSON conforming to the defined schema. You may utilize search grounding. Grounding citations can be included in the JSON string fields; they will be stripped during backend post-processing before JSON parsing.

Return ONLY a structured JSON object with this exact schema so the frontend can render the report:
{
  "businessName": "string",
  "overallScore": number, // Total optimized score calculated out of 100.
  "summary": "string (2-3 sentences overview of the standing of the listing)",
  "sections": [
    {
      "title": "string (Name of the audited section)",
      "category": "Ranking Factor" | "Best Practice",
      "standing": "string (The descriptive high-level status e.g., Excellent, Good, Weak)",
      "status": "Optimized | Needs Improvement | Missing",
      "score": number, // Weighted score assigned to this section
      "maxScore": number, // Maximum possible score for this section
      "whyItMatters": "string (Client-facing educational explanation)",
      "recommendation": "string (Step-by-step actionable optimization guidance)"
    }
  ],
  "competitors": [ // Array of EXACTLY 5 competitors found for the keyword. You MUST return exactly 5 competitors in this array, without truncation, omitting none, and ensuring exactly 5 items are populated in the JSON output, or an empty array if no serviceLocation was provided.
    {
      "name": "string (Exact competitor business name)",
      "estimatedScore": number, // out of 100
      "keyAdvantage": "string (What they do better than primary)",
      "weakness": "string (Their weakness relative to primary or generally)",
      "keywordsInName": "boolean (true if they are using keywords in their name)",
      "primaryCategory": "string",
      "secondaryCategories": ["string"],
      "reviewVelocity": "string (Describe their review frequency targeting a 180-day timespan with a numerical estimate, e.g., '15 reviews in the last 180 days', or '0 reviews in the last 180 days' if none are found. Prohibit generic text or omissions.)"
    }
  ],
  "businessDetails": {
    "name": "string (Exact business name)",
    "address": "string (Exact formatted address)",
    "phone": "string (Exact phone number)",
    "websiteUrl": "string (Exact website URL)",
    "reviewCount": number, // Total review count from Google Places API or search grounding
    "reviewVelocity": "string (Numerical velocity estimate, e.g., '12 reviews in the last 180 days')",
    "services": ["string (Exact custom services offered from the GMB profile/location page, mapped to the standard GBP taxonomy for Addiction Treatment, Mental Health, and Alcoholism Treatment, and retaining geographic location modifiers, e.g., 'Drug Rehabilitation in ${detectedCity}' or 'Drug Rehabilitation in ${detectedLocation}'. Strictly exclude crawl noise and generic therapies like Reiki, Yoga, Art/Music/Experiential Therapy, Alumni Services, Individual/Group/Family/Couples Therapy, Acupuncture.)"],
    "socials": ["string (Social media profile links found)"],
    "servicesSource": "string (Explain the sourcing of the services—specifically GMB listing snippets vs website crawl due to snippet limitations)",
    "placeId": "string (The verified Google Maps Place ID)"
  }
}`;

    const auditReportSchema = {
      type: Type.OBJECT,
      properties: {
        businessName: { type: Type.STRING },
        overallScore: { type: Type.INTEGER },
        summary: { type: Type.STRING },
        sections: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              category: { 
                type: Type.STRING,
                enum: ["Ranking Factor", "Best Practice"]
              },
              standing: { type: Type.STRING },
              status: { 
                type: Type.STRING,
                enum: ["Optimized", "Needs Improvement", "Missing"]
              },
              score: { type: Type.INTEGER },
              maxScore: { type: Type.INTEGER },
              whyItMatters: { type: Type.STRING },
              recommendation: { type: Type.STRING }
            },
            required: ["title", "category", "standing", "status", "score", "maxScore", "whyItMatters", "recommendation"]
          }
        },
        competitors: {
          type: Type.ARRAY,
          description: "Array of exactly 5 competitors found for the keyword. You MUST return exactly 5 competitors in this array without truncation, omitting none, and ensuring exactly 5 items are populated in the JSON output.",
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              estimatedScore: { type: Type.INTEGER },
              keyAdvantage: { type: Type.STRING },
              weakness: { type: Type.STRING },
              keywordsInName: { type: Type.BOOLEAN },
              primaryCategory: { type: Type.STRING },
              secondaryCategories: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              },
              reviewVelocity: { type: Type.STRING }
            },
            required: ["name", "estimatedScore", "keyAdvantage", "weakness", "keywordsInName", "primaryCategory", "secondaryCategories", "reviewVelocity"]
          }
        },
        businessDetails: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            address: { type: Type.STRING },
            phone: { type: Type.STRING },
            websiteUrl: { type: Type.STRING },
            reviewCount: { type: Type.INTEGER },
            reviewVelocity: { type: Type.STRING },
            services: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: `Exact custom services offered from the GMB profile/location page, mapped to the standard GBP taxonomy for Addiction Treatment, Mental Health, and Alcoholism Treatment, and retaining geographic location modifiers, e.g., 'Drug Rehabilitation in ${detectedCity}' or 'Drug Rehabilitation in ${detectedLocation}'. Strictly exclude crawl noise and generic therapies like Reiki, Yoga, Art/Music/Experiential Therapy, Alumni Services, Individual/Group/Family Therapy, Acupuncture.`
            },
            socials: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            servicesSource: { type: Type.STRING },
            placeId: { type: Type.STRING }
          },
          required: ["name", "address", "phone", "websiteUrl", "reviewCount", "reviewVelocity", "services", "socials", "servicesSource"]
        }
      },
      required: ["businessName", "overallScore", "summary", "sections", "competitors", "businessDetails"]
    };
    let response;
    let retries = 3;
    while (retries > 0) {
      try {
        response = await client.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
            temperature: 0.2,
          },
        });
        break; // success
      } catch (err: any) {
        retries--;
        console.warn(`Gemini API call failed. Retries remaining: ${retries}. Error:`, err.message || err);
        if (retries === 0) {
          throw err;
        }
        // Linear backoff: 2s, 4s, 6s
        const delay = (3 - retries) * 2000;
        console.warn(`Waiting ${delay / 1000}s before retrying...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    let reportText = "";
    try {
      reportText = response.text || "";
    } catch(err) {
      console.error("Error accessing response.text:", err);
    }
    
    if (!reportText) {
      console.error("Empty response from AI model. Full response:", JSON.stringify(response, null, 2));
      throw new Error("No report was generated by the AI agent. The AI model may have blocked the response (safety trip) or failed to output correctly.");
    }

    let reportData;
    try {
      let cleanText = reportText.trim();
      
      // Strip out grounding citation markers like [1], [2] along with any leading spaces
      cleanText = cleanText.replace(/\s*\[\d+\]/g, "");

      // Remove markdown blocks if the model accidentally includes them
      const jsonMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        cleanText = jsonMatch[1].trim();
      }
      
      // Aggressively extract the JSON object ignoring trailing grounding text
      const objectStart = cleanText.indexOf('{');
      const objectEnd = cleanText.lastIndexOf('}');
      if (objectStart !== -1 && objectEnd !== -1 && objectEnd > objectStart) {
        cleanText = cleanText.substring(objectStart, objectEnd + 1);
      }
      
      reportData = JSON.parse(cleanText);

      // Ensure businessDetails contains correct real-time data from Places API
      if (reportData.businessDetails) {
        if (!reportData.businessDetails.placeId && extractedPlaceId) {
          reportData.businessDetails.placeId = extractedPlaceId;
        }
        if (typeof placeReviewCount === "number" && (reportData.businessDetails.reviewCount === undefined || reportData.businessDetails.reviewCount === 0 || typeof reportData.businessDetails.reviewCount !== "number")) {
          reportData.businessDetails.reviewCount = placeReviewCount;
        }
        if (placeReviewVelocity && placeReviewVelocity !== "Not available from Places API" && (!reportData.businessDetails.reviewVelocity || reportData.businessDetails.reviewVelocity.includes("Not available"))) {
          reportData.businessDetails.reviewVelocity = placeReviewVelocity;
        }
      }

      // Post-process reportData.sections to override categories containing "website", "address", "service area", or "nap" to "Best Practice"
      if (reportData.sections && Array.isArray(reportData.sections)) {
        reportData.sections = reportData.sections.map((sec: any) => {
          if (sec && sec.title) {
            const titleLower = sec.title.toLowerCase();
            if (
              titleLower.includes("website") ||
              titleLower.includes("address") ||
              titleLower.includes("service area") ||
              titleLower.includes("nap")
            ) {
              sec.category = "Best Practice";
            }
          }
          return sec;
        });
      }
      
      // Post-processing fallback to ensure the required secondary categories explanation is present
      const secondaryCatSec = reportData.sections.find((s: any) => 
        s.title.toLowerCase().includes("secondary") || s.title.toLowerCase().includes("gap analysis")
      );
      if (secondaryCatSec) {
        const recText = secondaryCatSec.recommendation || "";
        const hasDashboard = recText.toLowerCase().includes("dashboard") || recText.toLowerCase().includes("gmb") || recText.toLowerCase().includes("gbp");
        const hasHidden = recText.toLowerCase().includes("hidden") || recText.toLowerCase().includes("restricted") || recText.toLowerCase().includes("places api");
        
        if (!hasDashboard || !hasHidden) {
          secondaryCatSec.recommendation = `${recText.trim()} Note: Active secondary categories (such as 'Alcoholism Treatment Program', 'Mental Health Service', or 'Rehabilitation Center') are often hidden or restricted from public search snippets and developer-facing Google Places API fields. We highly recommend logging into your Google Business Profile dashboard directly to verify which secondary categories are currently active on your listing.`;
        }
      }
    } catch (parseError) {
      console.error("JSON parse error on model output:", reportText);
      throw new Error("The AI model returned text that couldn't be parsed as JSON. Please try running the audit again.");
    }

    // Extract search grounding sources to pass along
    const groundingSources: any[] = [];
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (chunks && Array.isArray(chunks)) {
      chunks.forEach((chunk: any) => {
        if (chunk.web && chunk.web.uri) {
          groundingSources.push({
            title: chunk.web.title || "Search Results Insight",
            uri: chunk.web.uri,
          });
        }
      });
    }

    res.json({
      report: reportData,
      sources: groundingSources,
      location: mapLocationRef,
      placesApiStatus: placesApiStatus
    });
  } catch (err: any) {
    console.error("Audit error:", err);
    let errorMessage = err.message || "An unexpected error occurred during the Google Business Profile audit.";
    
    // Check if it's a 503 high demand error
    if (err.status === 503 || err.message?.includes("503") || err.message?.includes("high demand")) {
        errorMessage = "The AI model is currently experiencing high demand. This is a temporary Google API issue. Please wait a few seconds and try again.";
    }

    res.status(500).json({
      error: errorMessage,
    });
  }
});

// Setup Vite Dev server or Serve output static assets
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Express custom server running on http://0.0.0.0:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer();
}

export const maxDuration = 60;
export default app;
