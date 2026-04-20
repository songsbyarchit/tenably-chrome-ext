// Tenably — applicant scoring engine
// Max score: 100 pts across 5 weighted criteria

const SCORING_CONFIG = {
  RENT_BENCHMARK_MONTHLY: 1400, // £/mo default when no listing rent is given
  THRESHOLDS: {
    income:  { excellent: 3.0, good: 2.5, fair: 2.0, poor: 1.5 },
    invite:  65,   // minimum score to show "Invite to viewing"
  },
  WEIGHTS: {
    income:      40, // income : rent ratio
    documents:   25, // ID (8) + payslips (10) + bank statements (7)
    employment:  20, // type and stability of employment
    references:  10, // landlord / character references
    rightToRent:  5, // right to rent verified
    enquiry:      5, // how early they reached out (tiebreaker, not first-come-first-served)
  },
};

// ── Core scoring function ─────────────────────────────────────────────────
function scoreApplicant(tenant, monthlyRent) {
  const rent      = monthlyRent || SCORING_CONFIG.RENT_BENCHMARK_MONTHLY;
  const annualRent = rent * 12;
  let total = 0;
  const breakdown = [];

  // 1. Income : rent ratio (max 40 pts)
  const ratio = tenant.annualIncome > 0 ? tenant.annualIncome / annualRent : 0;
  let incScore;
  if      (ratio >= 3.0) incScore = 40;
  else if (ratio >= 2.5) incScore = 32;
  else if (ratio >= 2.0) incScore = 22;
  else if (ratio >= 1.5) incScore = 10;
  else                   incScore = 0;
  total += incScore;

  const incLabel = tenant.annualIncome === 0
    ? "No income declared"
    : `Income £${(tenant.annualIncome / 1000).toFixed(0)}k — ${
        ratio >= 3.0 ? `${ratio.toFixed(1)}× annual rent (strong)`    :
        ratio >= 2.5 ? `${ratio.toFixed(1)}× annual rent`             :
        ratio >= 2.0 ? `${ratio.toFixed(1)}× annual rent (borderline)`:
        ratio >= 1.5 ? `${ratio.toFixed(1)}× rent — below threshold`  :
                       `${ratio.toFixed(1)}× rent — does not qualify`
      }`;
  breakdown.push({
    status:   incScore >= 32 ? "green" : incScore >= 10 ? "amber" : "red",
    text:     incLabel,
    category: "income",
  });

  // 2. Documents (max 25 pts: ID=8, payslips=10, bank statements=7)
  let docScore = 0;
  if (tenant.docs.id)             docScore += 8;
  if (tenant.docs.payslips)       docScore += 10;
  if (tenant.docs.bankStatements) docScore += 7;
  total += docScore;

  const have    = [tenant.docs.id && "ID", tenant.docs.payslips && "payslips", tenant.docs.bankStatements && "bank statements"].filter(Boolean);
  const missing = [!tenant.docs.id && "ID", !tenant.docs.payslips && "payslips", !tenant.docs.bankStatements && "bank statements"].filter(Boolean);
  breakdown.push({
    status:   docScore === 25 ? "green" : docScore >= 15 ? "amber" : "red",
    text:     docScore === 25 ? "All documents uploaded (ID, payslips, bank statements)"
            : docScore === 0  ? "No documents uploaded"
            : `Uploaded: ${have.join(", ")} · Missing: ${missing.join(", ")}`,
    category: "documents",
  });

  // 3. Employment stability (max 20 pts)
  const empTable = {
    permanent:        { pts: 20, label: "Permanent employment" },
    fixedTerm:        { pts: 15, label: "Fixed-term contract"  },
    selfEmployed2plus:{ pts: 12, label: "Self-employed (2+ yrs)" },
    contractor:       { pts: 10, label: "Contractor"           },
    partTime:         { pts:  8, label: "Part-time employed"   },
    selfEmployed:     { pts:  6, label: "Self-employed (<2 yrs)" },
    student:          { pts:  2, label: "Student"              },
    unemployed:       { pts:  0, label: "Not currently employed" },
  };
  const emp = empTable[tenant.employmentType] || { pts: 0, label: "Employment unverified" };
  total += emp.pts;
  breakdown.push({
    status:   emp.pts >= 15 ? "green" : emp.pts >= 8 ? "amber" : "red",
    text:     emp.label,
    category: "employment",
  });

  // 4. References (max 10 pts)
  const refScore = tenant.references >= 2 ? 10 : tenant.references === 1 ? 5 : 0;
  total += refScore;
  breakdown.push({
    status:   refScore === 10 ? "green" : refScore === 5 ? "amber" : "red",
    text:     tenant.references >= 2  ? "2 references provided"
            : tenant.references === 1 ? "1 reference provided"
            :                           "No references provided",
    category: "references",
  });

  // 5. Right to rent (max 5 pts)
  total += tenant.rightToRent ? 5 : 0;
  breakdown.push({
    status:   tenant.rightToRent ? "green" : "red",
    text:     tenant.rightToRent ? "Right to rent verified" : "Right to rent not yet verified",
    category: "rightToRent",
  });

  // 6. Enquiry timing (max 5 pts — small tiebreaker, not first-come-first-served)
  const days = tenant.enquiredDaysAgo || 0;
  let enquiryScore;
  if      (days <= 2)  enquiryScore = 5;
  else if (days <= 5)  enquiryScore = 4;
  else if (days <= 7)  enquiryScore = 3;
  else if (days <= 14) enquiryScore = 2;
  else if (days <= 21) enquiryScore = 1;
  else                 enquiryScore = 0;
  total += enquiryScore;

  const daysLabel = days === 1 ? "1 day ago" : `${days} days ago`;
  breakdown.push({
    status:   enquiryScore >= 4 ? "green" : "amber",
    text:     enquiryScore >= 4 ? `Enquired ${daysLabel} — early enquiry`
            : enquiryScore >= 2 ? `Enquired ${daysLabel}`
            :                     `Enquired ${daysLabel} — later enquiry`,
    category: "enquiry",
  });

  const score = Math.round(total);
  const tier  = score >= 80 ? "excellent" : score >= 65 ? "good" : score >= 40 ? "borderline" : "unqualified";
  return {
    score,
    tier,
    breakdown,
    canInvite: score >= SCORING_CONFIG.THRESHOLDS.invite,
  };
}

// ── Score all tenants, return sorted by score desc ────────────────────────
function buildScoredTenants(monthlyRent) {
  return RAW_TENANTS
    .map(t => ({ ...t, ...scoreApplicant(t, monthlyRent) }))
    .sort((a, b) => b.score - a.score);
}

// ── 50 sample tenants ─────────────────────────────────────────────────────
// enquiredDaysAgo: how many days ago they first reached out to this listing
const RAW_TENANTS = [
  // — Tier 1 — strong all-round profiles
  { id:"t01", name:"Sarah Peterson",  initials:"SP", jobTitle:"Marketing Director",     employmentType:"permanent",        annualIncome: 75000, docs:{id:true, payslips:true, bankStatements:true},  references:2, rightToRent:true,  enquiredDaysAgo: 2  },
  { id:"t02", name:"James Mitchell",  initials:"JM", jobTitle:"Software Engineer",      employmentType:"permanent",        annualIncome: 82000, docs:{id:true, payslips:true, bankStatements:true},  references:2, rightToRent:true,  enquiredDaysAgo: 1  },
  { id:"t03", name:"Emma Chen",       initials:"EC", jobTitle:"Finance Analyst",        employmentType:"permanent",        annualIncome: 68000, docs:{id:true, payslips:true, bankStatements:true},  references:2, rightToRent:true,  enquiredDaysAgo: 3  },
  { id:"t04", name:"Oliver Walsh",    initials:"OW", jobTitle:"Solicitor",              employmentType:"permanent",        annualIncome: 95000, docs:{id:true, payslips:true, bankStatements:true},  references:2, rightToRent:true,  enquiredDaysAgo: 1  },
  { id:"t05", name:"Priya Sharma",    initials:"PR", jobTitle:"Data Scientist",         employmentType:"permanent",        annualIncome: 72000, docs:{id:true, payslips:true, bankStatements:true},  references:2, rightToRent:true,  enquiredDaysAgo: 4  },
  { id:"t06", name:"Ben Nakamura",    initials:"BN", jobTitle:"Investment Analyst",     employmentType:"permanent",        annualIncome:110000, docs:{id:true, payslips:true, bankStatements:true},  references:2, rightToRent:true,  enquiredDaysAgo: 2  },
  { id:"t07", name:"Tom Bradley",     initials:"TB", jobTitle:"GP Doctor",              employmentType:"permanent",        annualIncome: 88000, docs:{id:true, payslips:true, bankStatements:true},  references:2, rightToRent:true,  enquiredDaysAgo: 5  },
  { id:"t08", name:"Fatima Hassan",   initials:"FH", jobTitle:"Civil Engineer",         employmentType:"permanent",        annualIncome: 58000, docs:{id:true, payslips:true, bankStatements:true},  references:2, rightToRent:true,  enquiredDaysAgo: 1  },
  // — near-perfect, one flag each
  { id:"t09", name:"Michael Torres",  initials:"MT", jobTitle:"Product Manager",        employmentType:"permanent",        annualIncome: 78000, docs:{id:true, payslips:true, bankStatements:false}, references:2, rightToRent:true,  enquiredDaysAgo: 3  },
  { id:"t10", name:"Chloe Andersen",  initials:"CA", jobTitle:"UX Designer",            employmentType:"permanent",        annualIncome: 62000, docs:{id:true, payslips:true, bankStatements:true},  references:1, rightToRent:true,  enquiredDaysAgo: 6  },
  { id:"t11", name:"Leila Moradi",    initials:"LM", jobTitle:"Management Consultant",  employmentType:"permanent",        annualIncome: 91000, docs:{id:true, payslips:true, bankStatements:true},  references:2, rightToRent:false, enquiredDaysAgo: 2  },
  { id:"t12", name:"Harry Singh",     initials:"HS", jobTitle:"Structural Engineer",    employmentType:"permanent",        annualIncome: 65000, docs:{id:true, payslips:true, bankStatements:true},  references:1, rightToRent:true,  enquiredDaysAgo: 4  },
  { id:"t13", name:"Rachel Kim",      initials:"RK", jobTitle:"Senior Nurse",           employmentType:"permanent",        annualIncome: 45000, docs:{id:true, payslips:true, bankStatements:true},  references:2, rightToRent:true,  enquiredDaysAgo: 5  },
  { id:"t14", name:"Alex Turner",     initials:"AT", jobTitle:"DevOps Engineer",        employmentType:"fixedTerm",        annualIncome: 71000, docs:{id:true, payslips:true, bankStatements:true},  references:2, rightToRent:true,  enquiredDaysAgo: 7  },
  // — Tier 2 — good but not complete
  { id:"t15", name:"Mia Johnson",     initials:"MJ", jobTitle:"Secondary Teacher",      employmentType:"permanent",        annualIncome: 32000, docs:{id:true, payslips:true, bankStatements:true},  references:2, rightToRent:true,  enquiredDaysAgo: 8  },
  { id:"t16", name:"Lucas Wright",    initials:"LW", jobTitle:"IT Consultant",          employmentType:"contractor",       annualIncome: 55000, docs:{id:true, payslips:true, bankStatements:false}, references:1, rightToRent:true,  enquiredDaysAgo: 6  },
  { id:"t17", name:"Zoe Harrison",    initials:"ZH", jobTitle:"Junior Architect",       employmentType:"permanent",        annualIncome: 36000, docs:{id:true, payslips:true, bankStatements:true},  references:1, rightToRent:true,  enquiredDaysAgo: 9  },
  { id:"t18", name:"Noah Williams",   initials:"NW", jobTitle:"Business Analyst",       employmentType:"permanent",        annualIncome: 38000, docs:{id:true, payslips:true, bankStatements:false}, references:2, rightToRent:true,  enquiredDaysAgo: 11 },
  { id:"t19", name:"Isla Hartley",    initials:"IH", jobTitle:"Radiographer",           employmentType:"permanent",        annualIncome: 40000, docs:{id:true, payslips:true, bankStatements:true},  references:1, rightToRent:true,  enquiredDaysAgo: 7  },
  { id:"t20", name:"Jack Foster",     initials:"JF", jobTitle:"Accountant",             employmentType:"permanent",        annualIncome: 34000, docs:{id:true, payslips:true, bankStatements:false}, references:1, rightToRent:true,  enquiredDaysAgo: 13 },
  { id:"t21", name:"Grace Murphy",    initials:"GM", jobTitle:"Operations Manager",     employmentType:"permanent",        annualIncome: 39000, docs:{id:true, payslips:true, bankStatements:true},  references:0, rightToRent:true,  enquiredDaysAgo: 10 },
  { id:"t22", name:"Ravi Patel",      initials:"RP", jobTitle:"DevOps Engineer",        employmentType:"contractor",       annualIncome: 62000, docs:{id:true, payslips:true, bankStatements:false}, references:1, rightToRent:true,  enquiredDaysAgo: 8  },
  { id:"t23", name:"Clara Santos",    initials:"CS", jobTitle:"HR Manager",             employmentType:"permanent",        annualIncome: 35000, docs:{id:true, payslips:true, bankStatements:true},  references:2, rightToRent:false, enquiredDaysAgo: 12 },
  { id:"t24", name:"Sam Collins",     initials:"SC", jobTitle:"Graphic Designer",       employmentType:"permanent",        annualIncome: 33000, docs:{id:true, payslips:true, bankStatements:true},  references:1, rightToRent:true,  enquiredDaysAgo: 15 },
  { id:"t25", name:"Ella Davies",     initials:"ED", jobTitle:"Physiotherapist",        employmentType:"permanent",        annualIncome: 36000, docs:{id:true, payslips:true, bankStatements:false}, references:2, rightToRent:true,  enquiredDaysAgo: 9  },
  { id:"t26", name:"Liam O'Brien",    initials:"LO", jobTitle:"Freelance Consultant",   employmentType:"selfEmployed2plus", annualIncome: 35000, docs:{id:true, payslips:true, bankStatements:true},  references:1, rightToRent:true,  enquiredDaysAgo: 14 },
  { id:"t27", name:"Yasmin Ali",      initials:"YA", jobTitle:"Locum Pharmacist",       employmentType:"contractor",       annualIncome: 48000, docs:{id:true, payslips:true, bankStatements:true},  references:1, rightToRent:true,  enquiredDaysAgo: 6  },
  { id:"t28", name:"Charlie Brown",   initials:"CB", jobTitle:"Marketing Manager",      employmentType:"permanent",        annualIncome: 40000, docs:{id:true, payslips:false,bankStatements:false}, references:2, rightToRent:true,  enquiredDaysAgo: 16 },
  { id:"t29", name:"Amara Diallo",    initials:"AD", jobTitle:"Staff Nurse",            employmentType:"permanent",        annualIncome: 30000, docs:{id:true, payslips:true, bankStatements:true},  references:2, rightToRent:true,  enquiredDaysAgo: 10 },
  { id:"t30", name:"Connor Walsh",    initials:"CW", jobTitle:"Software Engineer",      employmentType:"fixedTerm",        annualIncome: 55000, docs:{id:true, payslips:true, bankStatements:false}, references:0, rightToRent:true,  enquiredDaysAgo: 18 },
  // — Tier 3 — borderline / missing key info
  { id:"t31", name:"Mei Lin",         initials:"ML", jobTitle:"Marketing Executive",    employmentType:"permanent",        annualIncome: 32000, docs:{id:true, payslips:true, bankStatements:true},  references:1, rightToRent:false, enquiredDaysAgo: 14 },
  { id:"t32", name:"Tyler James",     initials:"TJ", jobTitle:"Retail Supervisor",      employmentType:"partTime",         annualIncome: 22000, docs:{id:true, payslips:true, bankStatements:true},  references:1, rightToRent:true,  enquiredDaysAgo: 20 },
  { id:"t33", name:"Ryan Lee",        initials:"RL", jobTitle:"Freelance Designer",     employmentType:"selfEmployed",     annualIncome: 28000, docs:{id:true, payslips:true, bankStatements:false}, references:1, rightToRent:true,  enquiredDaysAgo: 17 },
  { id:"t34", name:"Kat Morgan",      initials:"KM", jobTitle:"Junior Developer",       employmentType:"permanent",        annualIncome: 28000, docs:{id:true, payslips:true, bankStatements:false}, references:0, rightToRent:true,  enquiredDaysAgo: 19 },
  { id:"t35", name:"Marcus Reed",     initials:"MR", jobTitle:"Delivery Driver",        employmentType:"selfEmployed",     annualIncome: 25000, docs:{id:true, payslips:true, bankStatements:true},  references:0, rightToRent:true,  enquiredDaysAgo: 22 },
  { id:"t36", name:"Anna Petrova",    initials:"AP", jobTitle:"Customer Service Rep",   employmentType:"permanent",        annualIncome: 24000, docs:{id:true, payslips:false,bankStatements:false}, references:2, rightToRent:false, enquiredDaysAgo: 15 },
  { id:"t37", name:"Damian Black",    initials:"DB", jobTitle:"Bartender",              employmentType:"partTime",         annualIncome: 19000, docs:{id:true, payslips:true, bankStatements:false}, references:1, rightToRent:true,  enquiredDaysAgo: 23 },
  { id:"t38", name:"Jade Williams",   initials:"JW", jobTitle:"Teaching Assistant",     employmentType:"partTime",         annualIncome: 21000, docs:{id:true, payslips:true, bankStatements:true},  references:1, rightToRent:true,  enquiredDaysAgo: 21 },
  { id:"t39", name:"Kevin Park",      initials:"KP", jobTitle:"Junior Designer",        employmentType:"permanent",        annualIncome: 27000, docs:{id:true, payslips:true, bankStatements:false}, references:0, rightToRent:true,  enquiredDaysAgo: 18 },
  { id:"t40", name:"Sophie Turner",   initials:"ST", jobTitle:"NHS Administrator",      employmentType:"permanent",        annualIncome: 25000, docs:{id:true, payslips:false,bankStatements:false}, references:2, rightToRent:true,  enquiredDaysAgo: 16 },
  { id:"t41", name:"Nadia Osei",      initials:"NO", jobTitle:"Retail Supervisor",      employmentType:"permanent",        annualIncome: 24000, docs:{id:true, payslips:true, bankStatements:true},  references:0, rightToRent:true,  enquiredDaysAgo: 24 },
  { id:"t42", name:"Ben Clarke",      initials:"BC", jobTitle:"Gig Economy Worker",     employmentType:"selfEmployed",     annualIncome: 24000, docs:{id:true, payslips:true, bankStatements:true},  references:1, rightToRent:true,  enquiredDaysAgo: 20 },
  { id:"t43", name:"Laura Hart",      initials:"LH", jobTitle:"Café Manager",           employmentType:"permanent",        annualIncome: 22000, docs:{id:true, payslips:true, bankStatements:true},  references:1, rightToRent:false, enquiredDaysAgo: 25 },
  // — Tier 4 — does not qualify
  { id:"t44", name:"Jake Rivera",     initials:"JR", jobTitle:"Currently Unemployed",   employmentType:"unemployed",       annualIncome:     0, docs:{id:true, payslips:false,bankStatements:false}, references:0, rightToRent:true,  enquiredDaysAgo: 22 },
  { id:"t45", name:"Amy Chen",        initials:"AC", jobTitle:"Student",                employmentType:"student",          annualIncome:  8000, docs:{id:false,payslips:false,bankStatements:false}, references:0, rightToRent:true,  enquiredDaysAgo: 27 },
  { id:"t46", name:"Tom Peters",      initials:"TP", jobTitle:"Recent Graduate",        employmentType:"permanent",        annualIncome: 22000, docs:{id:true, payslips:false,bankStatements:false}, references:0, rightToRent:true,  enquiredDaysAgo: 19 },
  { id:"t47", name:"Lisa Brown",      initials:"LB", jobTitle:"Temp Worker",            employmentType:"partTime",         annualIncome: 16000, docs:{id:true, payslips:true, bankStatements:false}, references:0, rightToRent:false, enquiredDaysAgo: 26 },
  { id:"t48", name:"Carlos Mendez",   initials:"CM", jobTitle:"Language Student",       employmentType:"student",          annualIncome:  5000, docs:{id:true, payslips:false,bankStatements:false}, references:0, rightToRent:false, enquiredDaysAgo: 28 },
  { id:"t49", name:"Sarah Keane",     initials:"SK", jobTitle:"Career Break",           employmentType:"unemployed",       annualIncome:     0, docs:{id:false,payslips:false,bankStatements:false}, references:0, rightToRent:true,  enquiredDaysAgo: 25 },
  { id:"t50", name:"David Wilson",    initials:"DW", jobTitle:"Zero-hours Contract",    employmentType:"partTime",         annualIncome: 14000, docs:{id:true, payslips:false,bankStatements:false}, references:0, rightToRent:true,  enquiredDaysAgo: 23 },
];
