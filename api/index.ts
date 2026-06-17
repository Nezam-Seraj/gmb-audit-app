import express from "express";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

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
              "X-Goog-FieldMask": "places.displayName,places.rating,places.userRatingCount,places.location,places.primaryType,places.primaryTypeDisplayName,places.types,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.regularOpeningHours"
            },
            body: JSON.stringify(body)
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
            "X-Goog-FieldMask": "places.displayName,places.rating,places.userRatingCount,places.primaryType,places.primaryTypeDisplayName,places.types,places.formattedAddress"
          },
          body: JSON.stringify(compBody)
        });

        if (compRes.ok) {
          const compData = await compRes.json();
          if (compData.places && compData.places.length > 0) {
            const compList = compData.places.slice(0, 5);
            let compText = "";
            compList.forEach((place: any, index: number) => {
              const formattedCats = getFormattedCategories(place);
              compText += `Competitor ${index + 1}:
- Name: ${place.displayName?.text || "Unknown"}
- EXACT Real Star Rating: ${place.rating || 0}
- EXACT Real Review Count: ${place.userRatingCount || 0}
- Address: ${place.formattedAddress || "Unknown"}
- Primary Category: ${formattedCats.primary}
- Mapped Secondary Categories: ${formattedCats.secondary.join(", ") || "None"}
`;
            });

            competitorApiContext = `
[CRITICAL GOOGLE PLACES API REAL-TIME COMPETITOR DATA INJECTION]
The following competitors were found by searching for the serviceLocation keyword "${serviceLocation}" using the Google Places API. You MUST treat the name, rating, review count, and mapped categories of these top competitors as absolute truth over grounded cached results when evaluating competitors:
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
      ? `\nAdditionally, use the provided Service & City keyword ("${serviceLocation}") to identify the real, live top 3 ranking competitors in the local search results on Google Maps. CRITICAL: DO NOT HALLUCINATE COMPETITORS. Only use real businesses that actually exist and rank for this keyword. Compare them against the primary business and provide your analysis in the "competitors" JSON array. Pay special attention to these local ranking factors:
1. Business Name: Are they adding keywords into their actual name? (Keyword stuffing in the title). If competitors are doing it, it's a massive ranking factor and the primary business is at a disadvantage. Adding keywords to the primary business name for parity would be a ranking boost, but could lead to profile suspension. This must be presented as an informed decision.
2. Categories: What is their primary category? CRITICAL: Be extremely accurate with secondary categories. DO NOT guess or hallucinate secondary categories. Only list secondary categories you have hard evidence for.
3. Review Velocity: Estimate review frequency specifically targeting a 180-day timespan with a numerical estimate (e.g., '15 reviews in the last 180 days'). BE CONSERVATIVE and do not over-estimate or hallucinate review counts. State the EXACT, TRUE review count for these competitors.` 
      : "";

    let sourceSpecificInstructions = "";
    if (placesApiStatus === "success") {
      sourceSpecificInstructions = `
CRITICAL INTEGRITY INSTRUCTION:
1. For reviews and ratings, you MUST use the exact numbers provided in the [CRITICAL GOOGLE PLACES API REAL-TIME DATA INJECTION] section (e.g. EXACT Real Total Review Count and EXACT Real Star Rating). Do NOT search the web to override or change these two numbers.
2. For Website URL, Phone Number, and Formatted Address, use the exact values from the Places API injection. However, for the UTM parameter audit, you MUST use Search Grounding to check the live Google Maps profile's website button link. Do not assume the injection URL represents the live button's link. Check if the live button link contains UTM parameters (e.g., "?utm_source=google").
3. For Categories (Primary and Secondary), you MUST use the injected "Primary Category (Mapped Place Type)" and "Associated Secondary Categories (Mapped Place Types)" as the baseline categories for the business, as these have been verified and mapped to official merchant-facing GMB categories. You may use search grounding to find additional details, but if they cannot be verified, you MUST explain in the recommendation text for "Secondary categories gap analysis" that secondary categories are hidden from standard search snippets and Places API developer fields, and advise the user to verify in their GBP dashboard. Ensure that you never report generic types like 'health' or 'medical_clinic' as categories.
`;
    } else {
      const categoryHints = getCategoryHints(finalBusinessName, googleMapsQuery);
      const hintsText = categoryHints.length > 0 ? `Target Category Hints (Based on Business/Query Keywords): ${categoryHints.join(", ")}` : "";
      sourceSpecificInstructions = `
CRITICAL SEARCH GROUNDING INSTRUCTION: Google Places API real-time data is NOT available (status: ${placesApiStatus}). You MUST use Search Grounding to locate the exact business profile on Google Search and Google Maps. Search Grounding often returns heavily cached, outdated, or mixed-source review numbers. You MUST prioritize the HIGHEST Google Review count you can confidently verify from recent search snippets, and avoid including Yelp or Facebook review counts. For the Website URL, use search grounding to find the URL linked to the Google Business Profile website button and check if it contains a UTM tracking parameter (e.g., "?utm_source=google").
For Categories (Primary and Secondary), you MUST use the provided "Target Category Hints" as baseline search candidates. You may use search grounding to find additional details, but if they cannot be verified, you MUST explain in the recommendation text for "Secondary categories gap analysis" that secondary categories are hidden from standard search snippets and Places API developer fields, and advise the user to verify in their GBP dashboard. Do not report generic types like 'health' or 'medical_clinic'; instead, report specific GMB categories.
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
CRITICAL INSTRUCTION: When reporting Categories (Primary and Secondary), you MUST ONLY use official Google My Business categories (refer to standard lists such as https://daltonluka.com/blog/google-my-business-categories). DO NOT hallucinate, guess, or make up category titles. Do NOT report generic developer types like 'health', 'point_of_interest', 'medical_clinic', or 'establishment' as categories if a more specific merchant-facing category (e.g., 'Addiction Treatment Center', 'Rehabilitation Center', 'Mental Health Clinic', 'Alcoholism Treatment Program', 'Mental Health Service') is active on the profile. Combine the injected types and Target Category Hints with search grounding to verify the exact category names visible on the business's public Maps profile, and list all that are active.
CRITICAL INSTRUCTION: When auditing "Secondary categories" for the primary business, you MUST advise the user in the recommendation text to verify their secondary categories (such as 'Alcoholism Treatment Program', 'Mental Health Service', or 'Rehabilitation Center') by logging into their Google Business Profile dashboard. Explain that secondary categories are often hidden or restricted from standard public search snippets and Google Places API developer fields, so verifying them directly inside the GBP dashboard is a critical best practice. Ensure that you never report generic developer types like 'health' or 'medical_clinic' as categories.
CRITICAL INSTRUCTION: When auditing "Hours vs competitors", you MUST use the injected "EXACT Real Opening Hours" value (when status is success) as the absolute truth for the business hours of the primary business. Specify the exact business hours in the audit text (e.g., "Open 24 hours" or "Monday - Friday: 9 AM - 5 PM").
CRITICAL INSTRUCTION: When auditing "Google Posts activity", you MUST search for the business's posts using search grounding and specify the date and topic of the most recent post (e.g., "The last post was on June 12th regarding community outreach"). If no posts are found, rate the status as "Missing" and state clearly that there are no posts on the profile.
CRITICAL INSTRUCTION: When auditing "Social Profiles", you MUST run targeted search queries (e.g., searching specifically for "[Business Name] Facebook", "[Business Name] Instagram", "[Business Name] LinkedIn") to verify their existence and active status. Verify if they display on the business's Google Business Profile knowledge panel, and specify exactly which platforms are active or linked.
CRITICAL INSTRUCTION: When evaluating "Website URL", pay extreme attention to verify if the URL contains a UTM tracking parameter (e.g., "?utm_source=google"). If the URL does not contain UTM parameters, it is a negative finding.
CRITICAL INSTRUCTION: When evaluating and extracting "Services" for "businessDetails.services", you MUST perform highly targeted search grounding queries (such as "[Business Name] Google Maps services" or "[Business Name] services list") to extract the services list from the public GMB profile/location page.
If the active categories for the business include "Addiction Treatment Center", "Mental Health Service", or "Alcoholism Treatment Program", you MUST strictly map search findings to the provided [STANDARD GBP SERVICES REFERENCE TAXONOMY] and append the dynamic location modifier (either "in ${detectedCity}" or "in ${detectedLocation}"). For example, if the audited business is in ${detectedLocation}, the retrieved services must match the exact naming convention including the suffix (e.g., "Drug Rehabilitation in ${detectedCity}" or "Drug Rehabilitation in ${detectedLocation}").
You MUST strictly exclude/filter out crawl noise, website-specific programs, or generic therapies (such as Reiki, Yoga, Art Therapy, Music Therapy, Alumni Services, Experiential Therapy, Individual/Group/Family/Couples Therapy, Acupuncture, etc.). Only standard predefined services from the taxonomy with the location modifier should be included for these categories.
You are strictly prohibited from stripping location names, and you MUST avoid generic guesses, assumptions, or placeholder listings, ensuring a 1:1 match of the actual services list currently offered on the public GMB profile.
You MUST strictly avoid hallucinating services that are not listed on the public GMB profile.
You MUST strictly ignore directory sites (such as PsychologyToday, StartYourRecovery, Rehabs.com, etc.) for compiling the businessDetails.services list, focusing strictly on Google My Business / Google Maps search snippet or knowledge panel information.
CRITICAL INSTRUCTION: You MUST populate the "businessDetails" object in the JSON response containing the primary business's details: "name", "address" (full formatted address), "phone", "websiteUrl" (the exact website URL), "services" (string array containing the mapped services based on the provided taxonomy and location modifiers, e.g., "Drug Rehabilitation in ${detectedCity}" or "Drug Rehabilitation in ${detectedLocation}", while strictly excluding crawl noise and generic therapies like Reiki, Yoga, Art/Music Therapy, Alumni Services, Experiential Therapy, Individual/Group/Family Therapy, and Acupuncture, and ignoring directory sites), and "socials" (string array of active social media profile links found).


Search Grounding is highly active and encouraged: You MUST search live Google search results, Google Maps, and other public listing sources using search grounding to retrieve the business description, evaluate photos/videos (exterior, interior, team), analyze Google Posts activity, check review replies (reply rate), and find social media links. CRITICAL: For social profiles, you MUST run targeted search queries (e.g., "[Business Name] Facebook", "[Business Name] Instagram", "[Business Name] LinkedIn") using search grounding to verify the business's presence and check if they display in the Google My Business knowledge panel. Perform thorough, in-depth searches to gather real details and write specific, detailed analyses for the primary business and competitors. Avoid writing generic, placeholder, or bland statements.

Conduct a rigorous audit against the following tiered criteria (Scores sum to 118 max, then MUST be normalized down to a 0-100 overall score). Assign each criteria below to either the "Ranking Factor" or "Best Practice" category as instructed:

**Tier 1 — Highest impact**
1. Business name competitive analysis: (Category: Ranking Factor, Weight: 15pts) - Detect keyword stuffing in the name. If competitors are stuffing keywords and the primary business is not, flag it as a risk/disadvantage. State that adding keywords for a ranking boost carries a risk of profile suspension (an informed decision must be made).
2. Primary category match: (Category: Ranking Factor, Weight: 15pts) - Identify its Primary category. Does it perfectly match what is ranking locally for the service?
3. Review velocity vs competitors: (Category: Ranking Factor, Weight: 12pts) - Estimate review frequency specifically targeting a 180-day timespan with a numerical estimate (e.g., '15 reviews in the last 180 days'). BE CONSERVATIVE and do not over-estimate or hallucinate exact numbers without evidence. How does their velocity compare to the top competitors?

**Tier 2 — Strong signals**
4. Secondary categories gap analysis: (Category: Ranking Factor, Weight: 10pts) - Are they missing critical secondary categories that top ranking competitors use? CRITICAL: DO NOT hallucinate secondary categories if they are not explicitly present. Only list gaps you are certain of.
5. Services listed: (Category: Ranking Factor, Weight: 9pts) - Are their services comprehensive and include city modifiers? CRITICAL: Closely read the actual service descriptions for city names before claiming they are missing.
6. Business description: (Category: Best Practice, Weight: 8pts) - Evaluate character count vs 750 max, and presence of robust Unique Selling Proposition (USP) and search term optimization.
7. Photos & media: (Category: Best Practice, Weight: 7pts) - Check the presence, recency, and variety of Photos/Videos (Team, Interior, Exterior).

**Tier 3 — Supporting signals**
8. Review quantity & recency: (Category: Ranking Factor, Weight: 6pts) - Total volume and how fresh the latest reviews are.
9. Review reply rate: (Category: Best Practice, Weight: 6pts) - Are they replying to reviews, especially negative ones?
10. Hours vs competitors: (Category: Best Practice, Weight: 5pts) - Are their hours competitive?
11. Website URL: (Category: Ranking Factor, Weight: 4pts) - Is the website linked? CRITICAL: Check specifically if the Website link utilizes a UTM tracking parameter (e.g., ?utm_source=google... on the main website button). Having no UTM parameters on the website button is a penalty.
12. Phone number: (Category: Best Practice, Weight: 4pts) - Clarity and consistency.
13. Address & service area: (Category: Ranking Factor, Weight: 4pts) - NAP consistency and valid service areas.

**Tier 4 — Completeness / Risk flags**
14. Google Posts activity: (Category: Best Practice, Weight: 3pts) - Activity within the last 7-30 days.
15. Products (Risk flag): (Category: Best Practice, Weight: 3pts) - Note: For treatment centers, Products shouldn't really be used. If they are used, note it as a detriment and flag that they should be removed. (If not used, give 3 pts).
16. Attributes & highlights: (Category: Best Practice, Weight: 3pts) - Use of relevant attributes (e.g., wheelchair accessible, amenities).
17. Social Profiles: (Category: Best Practice, Weight: 4pts) - Check if major social media profiles (Facebook, Instagram, YouTube, Twitter/X, LinkedIn, TikTok, etc.) are linked and displaying correctly on the Google Business Profile knowledge panel.

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
  "competitors": [ // Array of exactly the top 3 competitors found for the keyword, or empty array if no serviceLocation was provided
    {
      "name": "string (Exact competitor business name)",
      "estimatedScore": number, // out of 100
      "keyAdvantage": "string (What they do better than primary)",
      "weakness": "string (Their weakness relative to primary or generally)",
      "keywordsInName": "boolean (true if they are using keywords in their name)",
      "primaryCategory": "string",
      "secondaryCategories": ["string"],
      "reviewVelocity": "string (Describe their review frequency targeting a 180-day timespan with a numerical estimate, e.g., '15 reviews in the last 180 days')"
    }
  ],
  "businessDetails": {
    "name": "string (Exact business name)",
    "address": "string (Exact formatted address)",
    "phone": "string (Exact phone number)",
    "websiteUrl": "string (Exact website URL)",
    "services": ["string (Exact custom services offered from the GMB profile/location page, mapped to the standard GBP taxonomy for Addiction Treatment, Mental Health, and Alcoholism Treatment, and retaining geographic location modifiers, e.g., 'Drug Rehabilitation in ${detectedCity}' or 'Drug Rehabilitation in ${detectedLocation}'. Strictly exclude crawl noise and generic therapies like Reiki, Yoga, Art/Music/Experiential Therapy, Alumni Services, Individual/Group/Family/Couples Therapy, Acupuncture.)"],
    "socials": ["string (Social media profile links found)"]
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
            services: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: `Exact custom services offered from the GMB profile/location page, mapped to the standard GBP taxonomy for Addiction Treatment, Mental Health, and Alcoholism Treatment, and retaining geographic location modifiers, e.g., 'Drug Rehabilitation in ${detectedCity}' or 'Drug Rehabilitation in ${detectedLocation}'. Strictly exclude crawl noise and generic therapies like Reiki, Yoga, Art/Music/Experiential Therapy, Alumni Services, Individual/Group/Family Therapy, Acupuncture.`
            },
            socials: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: ["name", "address", "phone", "websiteUrl", "services", "socials"]
        }
      },
      required: ["businessName", "overallScore", "summary", "sections", "competitors", "businessDetails"]
    };

    const response = await client.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        temperature: 0.2,
      },
    });

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

export default app;
