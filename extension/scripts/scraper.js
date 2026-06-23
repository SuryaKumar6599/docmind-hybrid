function scrapeJob() {
  let company = "";
  let role = "";
  let jd = "";

  const url = window.location.href;

  if (url.includes("linkedin.com")) {
    role = document.querySelector(".job-details-jobs-unified-top-card__job-title")?.innerText?.trim() 
        || document.querySelector(".t-24")?.innerText?.trim() 
        || document.querySelector("h1")?.innerText?.trim() 
        || "";
    company = document.querySelector(".job-details-jobs-unified-top-card__company-name")?.innerText?.trim() 
        || document.querySelector(".job-details-jobs-unified-top-card__primary-description a")?.innerText?.trim() 
        || "";
    jd = document.querySelector(".jobs-description__container")?.innerText?.trim() 
        || document.querySelector(".jobs-description-content__text")?.innerText?.trim() 
        || "";
  } else if (url.includes("indeed.com")) {
    role = document.querySelector("h1.jobsearch-JobInfoHeader-title")?.innerText?.trim() || document.querySelector("h1")?.innerText?.trim() || "";
    company = document.querySelector('[data-testid="inlineHeader-companyName"]')?.innerText?.trim() || "";
    jd = document.getElementById("jobDescriptionText")?.innerText?.trim() || "";
  } else {
    // Generic fallback
    role = document.title.split("-")[0].split("|")[0].trim();
    jd = document.body.innerText.substring(0, 10000); // Grab body text
  }

  return { company, role, jd };
}

scrapeJob();
