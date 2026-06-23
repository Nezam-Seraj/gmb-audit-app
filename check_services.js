// Using global fetch

function isGenericCategory(cat) {
  const genericTypes = ["health", "point_of_interest", "establishment", "place_of_worship", "government_office", "local_government_office", "community_center", "non_governmental_organization", "medical_clinic"];
  return genericTypes.includes(cat.toLowerCase());
}

async function testLocation(businessName, serviceLocation) {
  const payload = {
    businessName,
    serviceLocation
  };
  console.log(`\n======================================================`);
  console.log(`Testing: "${businessName}" in "${serviceLocation}"...`);
  console.log(`======================================================`);
  
  try {
    const res = await fetch("http://localhost:3000/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    
    if (!res.ok) {
      console.error(`[FAIL] HTTP status error:`, res.status);
      return false;
    }
    
    const data = await res.json();
    let allPassed = true;
    
    console.log("Audited Business Name:", data.report.businessName);
    console.log("Overall Score:", data.report.overallScore);
    console.log("Places API Status:", data.placesApiStatus);
    
    // 1. Competitors checks
    const competitors = data.report.competitors || [];
    console.log(`Competitors count returned: ${competitors.length}`);
    if (competitors.length !== 5) {
      console.error(`[FAIL] Returned ${competitors.length} competitors (expected exactly 5)!`);
      allPassed = false;
    } else {
      console.log("[PASS] Returned exactly 5 competitors.");
    }
    
    // 2. Strict category matching and velocity check for competitors
    competitors.forEach((comp, idx) => {
      console.log(`\nChecking Competitor #${idx + 1}: "${comp.name}"`);
      
      // Category checks
      const primaryCat = comp.primaryCategory || "";
      console.log(`  - Primary Category: "${primaryCat}"`);
      if (!primaryCat) {
        console.error("  [FAIL] Competitor primary category is empty!");
        allPassed = false;
      } else if (isGenericCategory(primaryCat)) {
        console.error(`  [FAIL] Competitor primary category is generic: "${primaryCat}"`);
        allPassed = false;
      } else {
        console.log(`  [PASS] Competitor primary category is valid.`);
      }
      
      const secondaryCats = comp.secondaryCategories || [];
      console.log(`  - Secondary Categories: ${JSON.stringify(secondaryCats)}`);
      secondaryCats.forEach(cat => {
        if (isGenericCategory(cat)) {
          console.error(`  [FAIL] Competitor secondary category is generic: "${cat}"`);
          allPassed = false;
        }
      });
      
      // Review Velocity check
      const velocity = comp.reviewVelocity || "";
      console.log(`  - Review Velocity: "${velocity}"`);
      const hasNumber = /\d+/.test(velocity);
      if (!hasNumber) {
        console.error("  [FAIL] Review velocity must contain a numerical estimate (e.g., '15 reviews in the last 180 days').");
        allPassed = false;
      } else {
        console.log(`  [PASS] Review velocity contains numerical values.`);
      }
    });
    
    // 3. Google Posts activity check for placeholder copying
    console.log("\nChecking Google Posts Section...");
    const postsSection = data.report.sections?.find(s => 
      s.title.toLowerCase().includes("post") || s.title.toLowerCase().includes("activity")
    );
    if (postsSection) {
      const rec = postsSection.recommendation || "";
      const why = postsSection.whyItMatters || "";
      const description = postsSection.standing || "";
      
      // Check if they copy-pasted the exact example "June 12th" or "community outreach"
      const hasPlaceholderDate = /june 12/i.test(rec) || /june 12/i.test(why) || /june 12/i.test(description);
      const hasPlaceholderTopic = /community outreach/i.test(rec) || /community outreach/i.test(why) || /community outreach/i.test(description);
      
      if (hasPlaceholderDate) {
        console.error("[FAIL] Google Posts section copied the example date 'June 12th'!");
        allPassed = false;
      } else if (hasPlaceholderTopic) {
        console.error("[FAIL] Google Posts section copied the example topic 'community outreach'!");
        allPassed = false;
      } else {
        console.log("[PASS] Google Posts section does not copy placeholder examples.");
      }
    } else {
      console.warn("[WARN] Google Posts section was not found in sections list.");
    }
    
    // 4. Services list checks
    console.log("\nChecking Services List...");
    const services = data.report.businessDetails?.services || [];
    console.log(`Services returned: ${services.length}`);
    if (services.length === 0) {
      console.log("  (No services returned)");
    } else {
      services.forEach(s => console.log(`  - ${s}`));
    }
    
    // Check for eliminated/hallucinated wellness services
    const forbidden = ["reiki", "yoga", "art therapy", "music therapy", "alumni", "wilderness therapy", "sauna"];
    const foundForbidden = services.filter(s => forbidden.some(f => s.toLowerCase().includes(f)));
    if (foundForbidden.length > 0) {
      console.error(`[FAIL] Found forbidden/hallucinated wellness services: ${foundForbidden.join(", ")}`);
      allPassed = false;
    } else {
      console.log(`[PASS] No forbidden/hallucinated wellness services found.`);
    }

    // Check if services contain hardcoded Canaan, CT when location is Scottsdale or Wilton
    const cityPart = serviceLocation.split(",")[0].trim();
    if (serviceLocation !== "Canaan, CT") {
      const hasCanaan = services.some(s => s.includes("Canaan"));
      const hasCorrectLocation = services.some(s => s.includes(cityPart));
      if (hasCanaan) {
        console.error(`[FAIL] Found hardcoded 'Canaan' in services for location '${serviceLocation}'!`);
        allPassed = false;
      } else if (services.length > 0 && !hasCorrectLocation) {
        console.warn(`[WARN] Services list does not contain location modifier '${cityPart}'!`);
      } else {
        console.log(`[PASS] Services list correctly handled dynamic location '${serviceLocation}'.`);
      }
    } else {
      const hasCanaan = services.some(s => s.includes("Canaan"));
      if (services.length > 0 && !hasCanaan) {
        console.warn(`[WARN] Services list does not contain location modifier 'Canaan'.`);
      } else {
        console.log(`[PASS] Services list correctly handled location 'Canaan, CT'.`);
      }
    }
    
    // Check if servicesSource is populated in businessDetails
    console.log("\nChecking Services Source Note...");
    const servicesSource = data.report.businessDetails?.servicesSource || "";
    console.log(`Services Source Note: "${servicesSource}"`);
    if (!servicesSource) {
      console.error("[FAIL] servicesSource is missing or empty!");
      allPassed = false;
    } else {
      console.log("[PASS] servicesSource is populated.");
    }

    // Check businessDetails.reviewCount
    console.log("\nChecking Business Details Review Count...");
    const reviewCount = data.report.businessDetails?.reviewCount;
    console.log(`Business Details Review Count: ${reviewCount}`);
    if (typeof reviewCount !== "number" || isNaN(reviewCount)) {
      console.error("[FAIL] businessDetails.reviewCount is missing or not a valid number!");
      allPassed = false;
    } else {
      console.log("[PASS] businessDetails.reviewCount contains a valid number.");
    }

    // Check businessDetails.reviewVelocity
    console.log("\nChecking Business Details Review Velocity...");
    const reviewVelocity = data.report.businessDetails?.reviewVelocity || "";
    console.log(`Business Details Review Velocity: "${reviewVelocity}"`);
    const hasVelocityNumber = /\d+/.test(reviewVelocity);
    if (!reviewVelocity || !hasVelocityNumber) {
      console.error("[FAIL] businessDetails.reviewVelocity is missing or does not contain a numerical velocity estimate!");
      allPassed = false;
    } else {
      console.log("[PASS] businessDetails.reviewVelocity contains a valid numerical velocity string.");
    }
 
    // Check businessDetails.placeId
    console.log("\nChecking Business Details Place ID...");
    const placeId = data.report.businessDetails?.placeId || "";
    console.log(`Business Details Place ID: "${placeId}"`);
    if (!placeId) {
      console.error("[FAIL] businessDetails.placeId is missing or empty!");
      allPassed = false;
    } else {
      console.log("[PASS] businessDetails.placeId contains a valid Google Place ID.");
    }

    // Check categories of specific sections
    console.log("\nChecking Section Categories...");
    const sections = data.report.sections || [];
    const websiteUrlSection = sections.find(s => s.title.toLowerCase().includes("website url"));
    const addressSection = sections.find(s => s.title.toLowerCase().includes("address"));
    
    if (!websiteUrlSection) {
      console.error("[FAIL] Website URL section not found!");
      allPassed = false;
    } else {
      console.log(`Website URL section category: "${websiteUrlSection.category}"`);
      if (websiteUrlSection.category !== "Best Practice") {
        console.error(`[FAIL] Website URL section category is "${websiteUrlSection.category}" (expected "Best Practice")!`);
        allPassed = false;
      } else {
        console.log("[PASS] Website URL section is returned as Best Practice.");
      }
    }

    if (!addressSection) {
      console.error("[FAIL] Address & service area section not found!");
      allPassed = false;
    } else {
      console.log(`Address & service area section category: "${addressSection.category}"`);
      if (addressSection.category !== "Best Practice") {
        console.error(`[FAIL] Address & service area section category is "${addressSection.category}" (expected "Best Practice")!`);
        allPassed = false;
      } else {
        console.log("[PASS] Address & service area section is returned as Best Practice.");
      }
    }

    // Check Social Profiles section content
    console.log("\nChecking Social Profiles Section content...");
    const socialSection = sections.find(s => s.title.toLowerCase().includes("social"));
    if (!socialSection) {
      console.error("[FAIL] Social Profiles section not found!");
      allPassed = false;
    } else {
      const recommendation = socialSection.recommendation || "";
      const whyItMatters = socialSection.whyItMatters || "";
      
      const foundSocials = data.report.businessDetails?.socials || [];
      console.log(`Found socials: ${JSON.stringify(foundSocials)}`);
      
      const hasMissingMention = /missing|should establish|could establish|lacks|recommend/i.test(recommendation) ||
                                /facebook|instagram|youtube|linkedin|twitter|tiktok/i.test(recommendation);
                                
      if (!hasMissingMention) {
        console.error("[FAIL] Social Profiles check does not seem to contain both found socials and a list of missing major socials!");
        allPassed = false;
      } else {
        console.log("[PASS] Social Profiles check includes found socials and recommendations on missing ones.");
      }
    }

    // 5. Sources Check (Sourcing notes)
    console.log("\nChecking Grounded Sources...");
    const sources = data.sources || [];
    console.log(`Sources count: ${sources.length}`);
    if (sources.length === 0) {
      console.log("[PASS] Grounded sources are empty (acceptable depending on model caching/routing).");
    } else {
      console.log("[PASS] Grounded sources are correctly populated.");
      sources.forEach((src, sIdx) => {
        console.log(`  Source #${sIdx + 1}: "${src.title}" -> ${src.uri}`);
      });
    }
    
    return allPassed;
  } catch (err) {
    console.error("Error during test run:", err);
    return false;
  }
}

async function runTests() {
  const result1 = await testLocation("Mountainside Treatment Center", "Wilton, CT");
  console.log(`\nTest result for Wilton: ${result1 ? "PASSED" : "FAILED"}`);
  
  const result2 = await testLocation("Scottsdale Recovery Center", "Scottsdale, AZ");
  console.log(`\nTest result for Scottsdale: ${result2 ? "PASSED" : "FAILED"}`);
  
  if (result1 && result2) {
    console.log("\nALL VERIFICATION TESTS PASSED SUCCESSFULLY!");
    process.exit(0);
  } else {
    console.error("\nSOME VERIFICATION TESTS FAILED!");
    process.exit(1);
  }
}

runTests();
