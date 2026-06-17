// Using global fetch


async function testLocation(businessName, serviceLocation) {
  const payload = {
    businessName,
    serviceLocation
  };
  console.log(`\nTesting: "${businessName}" in "${serviceLocation}"...`);
  try {
    const res = await fetch("http://localhost:3000/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      console.error(`Error status for ${serviceLocation}:`, res.status);
      return;
    }
    const data = await res.json();
    console.log("=================== AUDIT RESULTS ===================");
    console.log("Audited Business Name:", data.report.businessName);
    console.log("Overall Score:", data.report.overallScore);
    console.log("Places API Status:", data.placesApiStatus);
    
    console.log("\nServices List:");
    const services = data.report.businessDetails?.services || [];
    if (services.length === 0) {
      console.log("  (No services returned)");
    } else {
      services.forEach(s => console.log(`  - ${s}`));
    }
    
    // Check if services have Canaan, CT when location is different
    if (serviceLocation !== "Canaan, CT") {
      const hasCanaan = services.some(s => s.includes("Canaan"));
      const hasCorrectLocation = services.some(s => s.includes(serviceLocation));
      if (hasCanaan) {
        console.error(`\n[FAIL] Found hardcoded 'Canaan' in services for location '${serviceLocation}'!`);
      } else if (services.length > 0 && !hasCorrectLocation) {
        console.warn(`\n[WARN] Services list does not contain location modifier '${serviceLocation}'!`);
      } else {
        console.log(`\n[PASS] Services list correctly handled dynamic location '${serviceLocation}'.`);
      }
    } else {
      const hasCanaan = services.some(s => s.includes("Canaan"));
      if (services.length > 0 && !hasCanaan) {
        console.warn(`\n[WARN] Services list does not contain location modifier 'Canaan'.`);
      } else {
        console.log(`\n[PASS] Services list correctly handled location 'Canaan, CT'.`);
      }
    }
  } catch (err) {
    console.error("Error during test:", err);
  }
}

async function runTests() {
  await testLocation("Mountainside Treatment Center", "Canaan, CT");
  await testLocation("Mountainside Treatment Center", "Wilton, CT");
}

runTests();
