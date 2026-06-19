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
    if (competitors.length === 0) {
      console.error("[FAIL] No competitors returned!");
      allPassed = false;
    } else if (competitors.length > 10) {
      console.error(`[FAIL] Returned too many competitors: ${competitors.length} (max 10)`);
      allPassed = false;
    } else {
      console.log(`[PASS] Returned a realistic count of competitors (${competitors.length}).`);
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
