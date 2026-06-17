export interface AuditSection {
  title: string;
  category: "Ranking Factor" | "Best Practice";
  standing: string;
  status: "Optimized" | "Needs Improvement" | "Missing";
  score: number;
  maxScore: number;
  whyItMatters: string;
  recommendation: string;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface CompetitorAnalysis {
  name: string;
  estimatedScore: number;
  keyAdvantage: string;
  weakness: string;
  keywordsInName: boolean;
  primaryCategory: string;
  secondaryCategories: string[];
  reviewVelocity: string;
}

export interface BusinessDetails {
  name: string;
  address: string;
  phone: string;
  websiteUrl: string;
  services: string[];
  socials: string[];
}

export interface AuditReport {
  businessName: string;
  overallScore: number;
  summary: string;
  sections: AuditSection[];
  competitors?: CompetitorAnalysis[];
  businessDetails?: BusinessDetails;
}

export interface LocationData {
  lat: number;
  lng: number;
}

export interface SavedAudit {
  id: string;
  timestamp: string;
  urlChecked: string;
  businessNameChecked: string;
  report: AuditReport;
  sources: GroundingSource[];
  location?: LocationData;
  placesApiStatus?: "success" | "no_results" | "api_error" | "missing_key";
}
