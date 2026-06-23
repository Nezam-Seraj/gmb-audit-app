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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      },
      signal: controller.signal
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
  } finally {
    clearTimeout(timeoutId);
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

  // If the primary category resolved to a generic type, try to promote
  // the first non-generic type from the types array instead.
  if (!primaryMapped || GENERIC_TYPES.has(primaryRaw)) {
    const fallbackType = typesRaw.find((t: string) => !GENERIC_TYPES.has(t));
    if (fallbackType) {
      primaryMapped = CATEGORY_MAP[fallbackType] || mapTypeToCategory(fallbackType);
    }
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

function inferServiceKeyword(businessName: string, query: string): string {
  const nameAndQuery = `${businessName || ""} ${query || ""}`.toLowerCase();
  if (/\b(rehab|addiction|detox|substance|recovery|sober|treatment|mountainside)\b/.test(nameAndQuery)) {
    return "Addiction Treatment Center";
  }
  if (/\b(dentist|dental|orthodontist|teeth)\b/.test(nameAndQuery)) {
    return "Dentist";
  }
  if (/\b(mental|psychiatr|therapist|counseling|psycholog|behavioral)\b/.test(nameAndQuery)) {
    return "Mental Health Service";
  }
  if (/\b(chiropract|back pain)\b/.test(nameAndQuery)) {
    return "Chiropractor";
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

    // 1. Parallel Short URL Expansion
    let expandedUrl = url;
    let coordinates: { lat: number, lng: number } | null = null;
    let extractedName = "";

    const expandUrlPromise = (async () => {
      if (url && (url.includes('goo.gl') || url.includes('g.page'))) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        try {
          const response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
          if (response.url) {
            expandedUrl = response.url;
          }
        } catch (e) {
          console.error("Error expanding short URL:", e);
        } finally {
          clearTimeout(timeoutId);
        }
      }

      if (expandedUrl) {
        // Coordinates Extraction
        const coordMatch = expandedUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (coordMatch) {
          coordinates = {
            lat: parseFloat(coordMatch[1]),
            lng: parseFloat(coordMatch[2])
          };
        } else {
          const queryCoordMatch = expandedUrl.match(/[?&](ll|q)=(-?\d+\.\d+),(-?\d+\.\d+)/);
          if (queryCoordMatch) {
            coordinates = {
              lat: parseFloat(queryCoordMatch[2]),
              lng: parseFloat(queryCoordMatch[3])
            };
          }
        }

        // Name Extraction
        const placeMatch = expandedUrl.match(/\/place\/([^\/]+)/);
        if (placeMatch) {
          const namePart = placeMatch[1].split('@')[0].split('/')[0];
          extractedName = decodeURIComponent(namePart.replace(/\+/g, ' ')).trim();
        } else {
          const qMatch = expandedUrl.match(/[?&]q=([^&]+)/);
          if (qMatch) {
            extractedName = decodeURIComponent(qMatch[1].replace(/\+/g, ' ')).trim();
          }
        }
      }
    })();

    await expandUrlPromise;

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
    let crawledSocials: string[] = [];
    let competitorApiContext = "";

    // 2. Parallel Primary Business & Competitor Fetches
    const primaryBusinessFetch = async () => {
      if (!process.env.GOOGLE_MAPS_PLATFORM_KEY || !googleMapsQuery) {
        placesApiStatus = process.env.GOOGLE_MAPS_PLATFORM_KEY ? "no_results" : "missing_key";
        return;
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
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
              radius: 5000.0
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
          signal: controller.signal
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

            // Lower timeout crawler
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
      } finally {
        clearTimeout(timeoutId);
      }
    };

    const competitorFetch = async () => {
      if (!process.env.GOOGLE_MAPS_PLATFORM_KEY || !serviceLocation) return;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      try {
        let queryText = serviceLocation;
        const lowerLoc = serviceLocation.toLowerCase();
        const hasServiceKeyword = /\b(rehab|addiction|treatment|recovery|dentist|dental|clinic|hospital|doctor|counseling|therapy|therapist|chiropractor)\b/.test(lowerLoc);
        const inferredKeyword = inferServiceKeyword(finalBusinessName, googleMapsQuery);
        if (!hasServiceKeyword && inferredKeyword) {
          queryText = `${inferredKeyword} in ${serviceLocation}`;
        }

        const compBody: any = {
          textQuery: queryText,
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
          signal: controller.signal
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
- Review Velocity Baseline: ${compVelocity} (Do NOT search the web for competitor review velocity; use this baseline count to report velocity directly)
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
      } finally {
        clearTimeout(timeoutId);
      }
    };

    // Execute in parallel
    await Promise.all([primaryBusinessFetch(), competitorFetch()]);

    const competitorPrompt = serviceLocation
      ? `\nUsing the keyword "${serviceLocation}", return exactly 5 real competitors from Google Maps local results in the "competitors" array. Do NOT hallucinate competitors. Use the injected competitor data (categories, review velocity baselines) as absolute truth — do NOT web-search for competitor categories or velocity. Note if competitors keyword-stuff their business name (ranking advantage, but adding keywords risks suspension).`
      : "";

    let sourceSpecificInstructions = "";
    if (placesApiStatus === "success") {
      sourceSpecificInstructions = `
DATA RULES: Use injected Places API review count and rating as truth (do NOT override via web search). Use Places API values for website URL, phone, and address. Use Search Grounding to check the live Maps profile website button for UTM parameters (Places API websiteUri lacks UTMs). For categories, use Search Grounding to find the full list of official GMB categories on the public listing — do not report generic developer types like 'health' or 'medical_clinic'.
`;
    } else {
      const categoryHints = getCategoryHints(finalBusinessName, googleMapsQuery);
      const hintsText = categoryHints.length > 0 ? `Category Hints: ${categoryHints.join(", ")}` : "";
      sourceSpecificInstructions = `
Places API data unavailable (${placesApiStatus}). Use Search Grounding to locate the business on Google Maps. Prioritize the highest verifiable Google review count (exclude Yelp/Facebook). Check the live Maps profile website button for UTM parameters. Use Search Grounding for official GMB categories — no generic developer types.
${hintsText}
`;
    }

    if (!detectedLocation) {
      detectedLocation = "Canaan, CT";
    }
    const detectedCity = detectedLocation.split(",")[0].trim();

    // 3. Define Parallel Prompts A & B
    const promptA = `You are a Local SEO and GBP optimization expert. "Circle Social" is NOT the business being audited.
Analyze: ${searchTarget}.
${placesApiContext}
${competitorApiContext}
${competitorPrompt}

- Review Count: ${placeReviewCount}
- Review Velocity: ${placeReviewVelocity}
Use injected metrics if available; otherwise use search grounding. reviewCount must be integer, reviewVelocity must be "X reviews in the last 180 days".
${sourceSpecificInstructions}

[SERVICES RULES]
Search "[Business Name] Google Maps services" to find active services. For Addiction Treatment/Mental Health/Alcoholism categories, map findings to standard GBP taxonomy (Drug Rehabilitation, Alcohol Rehabilitation, Detoxification, Intensive Outpatient Program, Outpatient Addiction Treatment, Medication-Assisted Treatment, Substance Abuse Counseling, Residential Treatment, Partial Hospitalization Program, Dual Diagnosis Treatment, Aftercare Support, Sober Living, Mental Health Treatment, Psychiatric Evaluation, CBT, DBT, Depression/Anxiety/Trauma Treatment, Medication Management, Psychotherapy, Alcoholism Treatment, Alcohol Detoxification, Alcohol Counseling, Relapse Prevention Planning, Support Groups) and append "in ${detectedCity}" or "in ${detectedLocation}".
Do NOT dump the entire taxonomy — only list services verified as active on the GMB profile. Exclude non-taxonomy items (Reiki, Yoga, Art/Music/Experiential Therapy, Acupuncture, etc.) and ignore directory sites. If none found, return 1-2 core services only.

All review velocities must be numerical ("X reviews in the last 180 days"). Use injected competitor categories/velocities as truth — no web searches for them.
Use search grounding to verify business details and find active social profiles.

Return ONLY JSON:
{"businessName":"string","summary":"string","competitors":[{"name":"string","estimatedScore":number,"keyAdvantage":"string","weakness":"string","keywordsInName":boolean,"primaryCategory":"string","secondaryCategories":["string"],"reviewVelocity":"string"}],"businessDetails":{"name":"string","address":"string","phone":"string","websiteUrl":"string","reviewCount":number,"reviewVelocity":"string","services":["string"],"socials":["string"],"servicesSource":"string","placeId":"string"}}`;

    const promptB = `You are a Local SEO and GBP optimization expert. "Circle Social" is NOT the business being audited.
Analyze: ${searchTarget}.
${placesApiContext}
${competitorApiContext}
${competitorPrompt}

- Review Count: ${placeReviewCount}
- Review Velocity: ${placeReviewVelocity}
${sourceSpecificInstructions}

Generate exactly 17 audit sections. Use search grounding to verify each. All review velocities must be numerical ("X reviews in the last 180 days"). Use injected opening hours as truth. Never report generic developer types as categories. Be professional, realistic, encouraging, and actionable.

1. Business name competitive analysis (Ranking Factor, 15pts) — Detect keyword stuffing. Flag risk if competitors stuff keywords.
2. Primary category match (Ranking Factor, 15pts) — Does primary category match local ranking?
3. Review velocity vs competitors (Ranking Factor, 12pts) — Numerical 180-day velocity comparison. Be conservative.
4. Secondary categories gap analysis (Ranking Factor, 10pts) — Missing categories vs competitors? Do NOT hallucinate. Advise verifying via GBP dashboard since secondary categories are often hidden.
5. Services listed (Ranking Factor, 9pts) — Comprehensive with city modifiers? Read actual descriptions before claiming missing.
6. Business description (Best Practice, 8pts) — Character count vs 750 max, USP, keyword optimization.
7. Photos & media (Best Practice, 7pts) — Presence, recency, variety (Team/Interior/Exterior).
8. Review quantity & recency (Ranking Factor, 6pts) — Total volume and freshness.
9. Review reply rate (Best Practice, 6pts) — Reply rate, especially to negative reviews.
10. Hours vs competitors (Best Practice, 5pts) — Use injected hours as truth. State exact hours.
11. Website URL (Best Practice, 4pts) — Check live Maps profile website button for UTM params via search grounding. No UTMs = penalty.
12. Phone number (Best Practice, 4pts) — Clarity and NAP consistency.
13. Address & service area (Best Practice, 4pts) — NAP consistency and service areas.
14. Google Posts activity (Best Practice, 3pts) — Search for real posts. Do NOT use placeholder examples. If none found, status="Missing".
15. Products (Best Practice, 3pts) — For treatment centers, products should not be used. If present, flag for removal.
16. Attributes & highlights (Best Practice, 3pts) — Relevant attributes (accessibility, amenities).
17. Social Profiles (Best Practice, 4pts) — Confirm active socials on GMB. List which of 7 major socials (Facebook, Instagram, YouTube, LinkedIn, TikTok, Twitter/X, Pinterest) are missing.

Return ONLY JSON:
{"sections":[{"title":"string","category":"Ranking Factor"|"Best Practice","standing":"string","status":"Optimized"|"Needs Improvement"|"Missing","score":number,"maxScore":number,"whyItMatters":"string","recommendation":"string"}]}`;

    // 5. Concurrent Gemini Calls with fail-fast retry setup (max 1 retry, no backoff delay)
    let callAResponse: any = null;
    let callBResponse: any = null;

    const executeCallA = async () => {
      let retries = 1;
      while (retries >= 0) {
        try {
          const res = await client.models.generateContent({
            model: "gemini-2.5-flash",
            contents: promptA,
            config: {
              tools: [{ googleSearch: {} }],
              temperature: 0.2
            },
          });
          return res;
        } catch (err: any) {
          retries--;
          console.warn(`Gemini Call A failed. Retries remaining: ${retries + 1}. Error:`, err.message || err);
          if (retries < 0) throw err;
          // Wait 2 seconds to let transient 503 demand spikes clear
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    };

    const executeCallB = async () => {
      let retries = 1;
      while (retries >= 0) {
        try {
          const res = await client.models.generateContent({
            model: "gemini-2.5-flash",
            contents: promptB,
            config: {
              tools: [{ googleSearch: {} }],
              temperature: 0.2
            },
          });
          return res;
        } catch (err: any) {
          retries--;
          console.warn(`Gemini Call B failed. Retries remaining: ${retries + 1}. Error:`, err.message || err);
          if (retries < 0) throw err;
          // Wait 2 seconds to let transient 503 demand spikes clear
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    };

    // Parallel execution of Gemini Calls
    const [resA, resB] = await Promise.all([executeCallA(), executeCallB()]);
    callAResponse = resA;
    callBResponse = resB;

    let reportTextA = "";
    let reportTextB = "";
    try {
      reportTextA = callAResponse.text || "";
      reportTextB = callBResponse.text || "";
    } catch (err) {
      console.error("Error accessing response text:", err);
    }

    if (!reportTextA || !reportTextB) {
      throw new Error("No report was generated by one of the AI agent calls. The AI model may have blocked the response (safety trip) or failed to output correctly.");
    }

    const parseJSON = (text: string) => {
      let cleanText = text.trim();
      cleanText = cleanText.replace(/\s*\[\d+\]/g, ""); // Strip grounding citation numbers
      const jsonMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        cleanText = jsonMatch[1].trim();
      }
      const objectStart = cleanText.indexOf('{');
      const objectEnd = cleanText.lastIndexOf('}');
      if (objectStart !== -1 && objectEnd !== -1 && objectEnd > objectStart) {
        cleanText = cleanText.substring(objectStart, objectEnd + 1);
      }
      return JSON.parse(cleanText);
    };

    const dataA = parseJSON(reportTextA);
    const dataB = parseJSON(reportTextB);

    // Merge sections and metadata
    const reportData = {
      businessName: dataA.businessName,
      overallScore: 0,
      summary: dataA.summary,
      sections: dataB.sections || [],
      competitors: dataA.competitors || [],
      businessDetails: dataA.businessDetails || {}
    };

    // Calculate Overall Score Mathematically
    let sumScores = 0;
    if (reportData.sections && Array.isArray(reportData.sections)) {
      reportData.sections.forEach((sec: any) => {
        if (typeof sec.score === "number") {
          sumScores += sec.score;
        }
      });
    }
    reportData.overallScore = Math.round((sumScores / 118) * 100);

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

    // Post-process sections categories overrides
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

    // Extract search grounding sources to pass along
    const groundingSources: any[] = [];
    const collectSources = (response: any) => {
      const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (chunks && Array.isArray(chunks)) {
        chunks.forEach((chunk: any) => {
          if (chunk.web && chunk.web.uri) {
            if (!groundingSources.some(src => src.uri === chunk.web.uri)) {
              groundingSources.push({
                title: chunk.web.title || "Search Results Insight",
                uri: chunk.web.uri,
              });
            }
          }
        });
      }
    };
    collectSources(callAResponse);
    collectSources(callBResponse);

    res.json({
      report: reportData,
      sources: groundingSources,
      location: mapLocationRef,
      placesApiStatus: placesApiStatus
    });
  } catch (err: any) {
    console.error("Audit error:", err);
    let errorMessage = err.message || "An unexpected error occurred during the Google Business Profile audit.";

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
