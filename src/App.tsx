import { useState, useEffect, MouseEvent, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
// @ts-ignore
import html2pdf from "html2pdf.js";
import { 
  Search, 
  MapPin, 
  CheckCircle, 
  AlertTriangle, 
  XCircle, 
  Clock, 
  BookOpen, 
  Compass, 
  FileText, 
  Trash2, 
  ExternalLink, 
  Activity, 
  Layers, 
  Image, 
  MessageSquare, 
  Share2, 
  Printer, 
  Sparkle, 
  HelpCircle, 
  Sliders, 
  CheckSquare, 
  Square,
  ChevronDown,
  ChevronUp,
  History,
  TrendingUp,
  Star
} from "lucide-react";
import { AuditReport, SavedAudit, GroundingSource, AuditSection } from "./types";
import { LocationMap } from "./components/LocationMap";

export default function App() {
  // Input fields
  const [url, setUrl] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [serviceLocation, setServiceLocation] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Active Report
  const [report, setReport] = useState<AuditReport | null>(null);
  const [sources, setSources] = useState<GroundingSource[]>([]);
  const [mapLocation, setMapLocation] = useState<{lat: number, lng: number} | null>(null);
  const [placesApiStatus, setPlacesApiStatus] = useState<"success" | "no_results" | "api_error" | "missing_key" | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Gamification fixes checklist state
  const [fixes, setFixes] = useState<{ id: string; text: string; completed: boolean; simKey?: string; title?: string }[]>([]);

  // History system
  const [history, setHistory] = useState<SavedAudit[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // SEO Simulator state
  const [simNameCorrect, setSimNameCorrect] = useState(true);
  const [simCategoryMatch, setSimCategoryMatch] = useState(true);
  const [simDescOptimal, setSimDescOptimal] = useState(false);
  const [simRecentPhotos, setSimRecentPhotos] = useState(false);
  const [simReviewReplies, setSimReviewReplies] = useState(50); // % of replies
  const [simPostingFrequency, setSimPostingFrequency] = useState(0); // posts per month
  const [simAttributesComp, setSimAttributesComp] = useState(false);

  // Loading steps animation
  const loadingPhases = [
    "Analyzing Business Profile...",
    "Retrieving rating and reviews...",
    "Evaluating Name and Address consistency...",
    "Reviewing primary and secondary categories...",
    "Reading profile description...",
    "Checking photos and updates...",
    "Finalizing SEO score..."
  ];

  useEffect(() => {
    let phaseTimer: any;
    if (loading) {
      setLoadingStep(0);
      phaseTimer = setInterval(() => {
        setLoadingStep((prev) => {
          if (prev < loadingPhases.length - 1) {
            return prev + 1;
          }
          return prev;
        });
      }, 1500);
    }
    return () => clearInterval(phaseTimer);
  }, [loading]);

  // Load history on mount
  useEffect(() => {
    const cached = localStorage.getItem("saved_gbp_audits");
    if (cached) {
      try {
        setHistory(JSON.parse(cached));
      } catch (e) {
        console.error("Error reading saved audits", e);
      }
    }
  }, []);

  // Save history helper
  const saveAuditToHistory = (newReport: AuditReport, listSources: GroundingSource[], inputUrl: string, inputName: string, locationData?: {lat: number, lng: number}, apiStatus?: "success" | "no_results" | "api_error" | "missing_key") => {
    const newAudit: SavedAudit = {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      }),
      urlChecked: inputUrl,
      businessNameChecked: inputName || newReport.businessName,
      report: newReport,
      sources: listSources,
      location: locationData,
      placesApiStatus: apiStatus
    };

    const updated = [newAudit, ...history].slice(0, 15); // keep last 15 reports
    setHistory(updated);
    localStorage.setItem("saved_gbp_audits", JSON.stringify(updated));
  };

  const deleteHistoryItem = (id: string, e: MouseEvent) => {
    e.stopPropagation();
    const updated = history.filter((item) => item.id !== id);
    setHistory(updated);
    localStorage.setItem("saved_gbp_audits", JSON.stringify(updated));
  };

  // Demo presets search queries
  const demoPresets = [
    {
      name: "Katz's Delicatessen",
      url: "https://www.google.com/maps/place/Katz's+Delicatessen/data=!4m2!3m1!1s0x89c25984578b87e9:0xffff4c979cf733bc"
    },
    {
      name: "The Green Bean Seattle",
      url: "https://www.google.com/maps/place/Green+Bean+Coffeehouse/data=!4m2!3m1!1s0x5490146b9ce8fc61:0xa1d4715dfaff975b"
    },
    {
      name: "Lombardi's Pizza New York",
      url: "https://www.google.com/maps/place/Lombardi's/data=!4m2!3m1!1s0x89c259868ba89f0d:0x39a174c0c16b67bc"
    }
  ];

  const handleApplyPreset = (preset: { name: string; url: string }) => {
    setBusinessName(preset.name);
    setUrl(preset.url);
    setError(null);
  };

  // Run audit trigger
  const runGbpAudit = async (customUrl?: string, customName?: string) => {
    const targetUrl = customUrl !== undefined ? customUrl : url;
    const targetName = customName !== undefined ? customName : businessName;

    if (!targetUrl.trim() && !targetName.trim() && !serviceLocation.trim()) {
      setError("Please key in a Google Business Profile URL, describe the Business Name, or enter the Service & City to audit.");
      return;
    }

    setLoading(true);
    setError(null);
    setReport(null);
    setMapLocation(null);
    setSources([]);
    setPlacesApiStatus(null);

    try {
      const resp = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          url: targetUrl, 
          businessName: targetName,
          serviceLocation
        })
      });

      const data = await resp.json();

      if (!resp.ok) {
        throw new Error(data.error || "Server could not generate listing diagnostics. Ensure your API key is validated.");
      }

      setReport(data.report);
      setSources(data.sources || []);
      setPlacesApiStatus(data.placesApiStatus || null);
      if (data.location) {
        setMapLocation(data.location);
      }

      // Compile gamified client checklist from non-optimal criteria
      const neededFixes = (data.report as AuditReport).sections
        .filter((sec) => sec.status !== "Optimized")
        .map((sec) => {
          let simKey = "";
          const titleLower = sec.title.toLowerCase();
          if (titleLower.includes("name") || titleLower.includes("spam")) {
            simKey = "name";
          } else if (titleLower.includes("category") || titleLower.includes("categories")) {
            simKey = "category";
          } else if (titleLower.includes("description") || titleLower.includes("desc")) {
            simKey = "description";
          } else if (titleLower.includes("photo") || titleLower.includes("media") || titleLower.includes("visual")) {
            simKey = "photos";
          } else if (titleLower.includes("reply") || titleLower.includes("replies") || titleLower.includes("rate")) {
            simKey = "replies";
          } else if (titleLower.includes("post") || titleLower.includes("activity") || titleLower.includes("update")) {
            simKey = "posts";
          } else if (
            titleLower.includes("attribute") || 
            titleLower.includes("url") || 
            titleLower.includes("website") || 
            titleLower.includes("phone") || 
            titleLower.includes("address") ||
            titleLower.includes("social")
          ) {
            simKey = "attributes";
          }

          return {
            id: `fix-${sec.title.replace(/\s+/g, "_")}`,
            text: sec.recommendation.split("\n")[0] || `Optimize your ${sec.title} settings`,
            completed: false,
            simKey,
            title: sec.title
          };
        });
      setFixes(neededFixes);

      // Populate predictive simulator with values reflecting output
      const coreInfo = data.report.sections.find((s: any) => s.title.includes("Core") || s.title.includes("Information") || s.title.includes("NAP"));
      const categorySec = data.report.sections.find((s: any) => s.title.includes("Category") || s.title.includes("Categories"));
      const descSec = data.report.sections.find((s: any) => s.title.includes("Description"));
      const visualSec = data.report.sections.find((s: any) => s.title.includes("Visual") || s.title.includes("Photo"));
      const reviewsSec = data.report.sections.find((s: any) => s.title.includes("Review") || s.title.includes("Rating"));
      const postsSec = data.report.sections.find((s: any) => s.title.includes("Post") || s.title.includes("Update") || s.title.includes("Activity"));
      const attributesSec = data.report.sections.find((s: any) => s.title.includes("Technical") || s.title.includes("Attribute") || s.title.includes("Link"));

      setSimNameCorrect(coreInfo ? coreInfo.status === "Optimized" : true);
      setSimCategoryMatch(categorySec ? categorySec.status === "Optimized" : true);
      setSimDescOptimal(descSec ? descSec.status === "Optimized" : false);
      setSimRecentPhotos(visualSec ? visualSec.status === "Optimized" : false);
      setSimAttributesComp(attributesSec ? attributesSec.status === "Optimized" : false);

      if (reviewsSec) {
        setSimReviewReplies(reviewsSec.status === "Optimized" ? 95 : reviewsSec.status === "Needs Improvement" ? 45 : 10);
      }
      if (postsSec) {
        setSimPostingFrequency(postsSec.status === "Optimized" ? 4 : postsSec.status === "Needs Improvement" ? 1 : 0);
      }

      // Save report to localStorage timeline
      saveAuditToHistory(data.report, data.sources || [], targetUrl, targetName, data.location, data.placesApiStatus);

    } catch (err: any) {
      console.error(err);
      setError(err.message || "Unable to reach server. Ensure key credentials are bound.");
    } finally {
      setLoading(false);
    }
  };

  const handleToggleFix = (id: string) => {
    setFixes((prev) => {
      const updated = prev.map((f) => (f.id === id ? { ...f, completed: !f.completed } : f));
      const toggledFix = updated.find((f) => f.id === id);
      if (toggledFix && toggledFix.simKey) {
        const completed = toggledFix.completed;
        if (toggledFix.simKey === "name") {
          setSimNameCorrect(completed);
        } else if (toggledFix.simKey === "category") {
          setSimCategoryMatch(completed);
        } else if (toggledFix.simKey === "description") {
          setSimDescOptimal(completed);
        } else if (toggledFix.simKey === "photos") {
          setSimRecentPhotos(completed);
        } else if (toggledFix.simKey === "replies") {
          setSimReviewReplies(completed ? 95 : 10);
        } else if (toggledFix.simKey === "posts") {
          setSimPostingFrequency(completed ? 4 : 0);
        } else if (toggledFix.simKey === "attributes") {
          const attrsItems = updated.filter((f) => f.simKey === "attributes");
          const allAttrsCompleted = attrsItems.every((f) => f.completed);
          setSimAttributesComp(allAttrsCompleted);
        }
      }
      return updated;
    });
  };

  useEffect(() => {
    setFixes((prev) => {
      let changed = false;
      const updated = prev.map((f) => {
        let targetCompleted = f.completed;
        if (f.simKey === "name") {
          targetCompleted = simNameCorrect;
        } else if (f.simKey === "category") {
          targetCompleted = simCategoryMatch;
        } else if (f.simKey === "description") {
          targetCompleted = simDescOptimal;
        } else if (f.simKey === "photos") {
          targetCompleted = simRecentPhotos;
        } else if (f.simKey === "replies") {
          const repliesItems = prev.filter((item) => item.simKey === "replies");
          const allCompleted = repliesItems.every((item) => item.completed);
          const simStateCompleted = simReviewReplies >= 80;
          if (simStateCompleted && !allCompleted) {
            targetCompleted = true;
          } else if (!simStateCompleted && allCompleted) {
            targetCompleted = false;
          } else {
            targetCompleted = f.completed;
          }
        } else if (f.simKey === "posts") {
          const postsItems = prev.filter((item) => item.simKey === "posts");
          const allCompleted = postsItems.every((item) => item.completed);
          const simStateCompleted = simPostingFrequency >= 4;
          if (simStateCompleted && !allCompleted) {
            targetCompleted = true;
          } else if (!simStateCompleted && allCompleted) {
            targetCompleted = false;
          } else {
            targetCompleted = f.completed;
          }
        } else if (f.simKey === "attributes") {
          const attrsItems = prev.filter((item) => item.simKey === "attributes");
          const allCompleted = attrsItems.every((item) => item.completed);
          if (simAttributesComp && !allCompleted) {
            targetCompleted = true;
          } else if (!simAttributesComp && allCompleted) {
            targetCompleted = false;
          } else {
            targetCompleted = f.completed;
          }
        }

        if (targetCompleted !== f.completed) {
          changed = true;
          return { ...f, completed: targetCompleted };
        }
        return f;
      });
      return changed ? updated : prev;
    });
  }, [
    simNameCorrect,
    simCategoryMatch,
    simDescOptimal,
    simRecentPhotos,
    simReviewReplies,
    simPostingFrequency,
    simAttributesComp
  ]);

  // Copy report summary to clipboard
  const handleCopySummary = () => {
    if (!report) return;
    const txt = `✨ Circle Social GBP Audit report for: ${report.businessName} ✨\nOverall Optimization score: ${report.overallScore}/100\n\nExecutive Summary: ${report.summary}\n\nRead the full report on our Local SEO cockpit.`;
    navigator.clipboard.writeText(txt);
    alert("Report overview copied to clipboard!");
  };

  const handleTriggerPrint = () => {
    if (!report || !contentRef.current) return;
    setIsExporting(true);
    // Wait for React to eagerly expand accordions before capturing
    setTimeout(() => {
      if (!contentRef.current) return;
      const opt = {
        margin:       [0.5, 0.5, 0.5, 0.5] as [number, number, number, number],
        filename:     `${report.businessName.replace(/\s+/g, '_')}_Audit.pdf`,
        image:        { type: 'jpeg' as "jpeg", quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, logging: false },
        jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' as "portrait" }
      };
      
      html2pdf().set(opt).from(contentRef.current).save().then(() => {
        setIsExporting(false);
      });
    }, 400);
  };

  // Calculated simulated score based on client variables (Sum to 100 maximum matches standard weights)
  const simulatedScore = (() => {
    let score = 0;
    // 1. Core Info (20 points max)
    score += simNameCorrect ? 20 : 8;
    // 2. Categories (15 points max)
    score += simCategoryMatch ? 15 : 5;
    // 3. Description (10 points max)
    score += simDescOptimal ? 10 : 3;
    // 4. Photos (15 points max)
    score += simRecentPhotos ? 15 : 5;
    // 5. Reviews Reply score (20 points max)
    score += Math.round((simReviewReplies / 100) * 20);
    // 6. Posting activity (10 points max)
    score += simPostingFrequency >= 4 ? 10 : simPostingFrequency >= 1 ? 6 : 2;
    // 7. Attributes checklist (10 points max)
    score += simAttributesComp ? 10 : 4;

    return Math.min(100, Math.max(0, score));
  })();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans antialiased selection:bg-teal-500 selection:text-white pb-16">
      
      {/* Top Professional Header Bar - Matches Professional Polish Template */}
      <header className="bg-slate-900 text-white px-8 py-6 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4 sticky top-0 z-40 shadow-md no-print">
        <div>
          <h1 className="text-xs font-bold uppercase tracking-widest text-teal-400">Circle Social</h1>
          <h2 className="text-2xl font-display tracking-tight text-white flex items-center gap-2">
            Google Business Profile Auditor
          </h2>
        </div>
        <div className="text-left sm:text-right flex flex-col justify-center sm:items-end">
          <div className="flex items-center gap-2 mt-1">
            <button
              id="history-btn-toggle"
              onClick={() => setShowHistory(!showHistory)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all ${
                showHistory 
                  ? "bg-teal-500 text-white border-teal-400" 
                  : "bg-slate-800 border-slate-700 hover:border-slate-600 text-slate-300 pointer"
              }`}
            >
              <History className="h-3.5 w-3.5" />
              <span>History ({history.length})</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container Layout */}
      <main className="max-w-7xl mx-auto px-4 sm:px-8 pt-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Side Column: Audit Inputs, presets, and live SEO simulator */}
        <div className="lg:col-span-4 space-y-6 no-print">
          
          {/* Main Form Panel */}
          <div className="p-6 bg-white rounded-2xl shadow-sm border border-slate-200">
            <div className="flex items-center gap-2 mb-4 pb-2 border-b border-slate-100">
              <span className="p-1.5 rounded-lg bg-teal-50 text-teal-600">
                <Search className="h-4 w-4" />
              </span>
              <h2 className="font-display font-bold text-slate-800 text-lg">New Audit</h2>
            </div>
            
            <p className="text-xs text-slate-600 mb-5 leading-relaxed">
              Analyze a public business profile. Examine core information, categories, description, and visual assets.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                  GBP Profile URL or Share Link
                </label>
                <input
                  id="gbp-url-input"
                  type="url"
                  placeholder="https://www.google.com/maps/place/..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 outline-none transition-all placeholder:text-slate-400"
                />
              </div>

              <div className="flex items-center gap-2 py-1">
                <div className="h-px bg-slate-200 flex-1"></div>
                <span className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-widest">Or Search Name</span>
                <div className="h-px bg-slate-200 flex-1"></div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                  Business Name (Optional)
                </label>
                <input
                  id="business-name-input"
                  type="text"
                  placeholder="e.g. Katz's Delicatessen New York"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 outline-none transition-all placeholder:text-slate-400"
                />
              </div>
              
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                  Service & City (Keyword Target)
                </label>
                <input
                  type="text"
                  placeholder="e.g. cocaine addiction treatment tampa"
                  value={serviceLocation}
                  onChange={(e) => setServiceLocation(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 outline-none transition-all placeholder:text-slate-400"
                />
              </div>

              {error && (
                <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2.5 text-rose-800 text-xs">
                  <XCircle className="h-4 w-4 text-rose-600 mt-0.5 shrink-0" />
                  <span className="leading-snug font-medium">{error}</span>
                </div>
              )}

              <button
                id="audit-submit-btn"
                onClick={() => runGbpAudit()}
                disabled={loading}
                className="w-full bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-xs font-bold uppercase tracking-widest py-3 px-4 rounded-xl shadow-md flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-[0.98]"
              >
                {loading ? (
                  <>
                    <Activity className="h-3.5 w-3.5 animate-spin text-teal-200" />
                    <span>Analyzing...</span>
                  </>
                ) : (
                  <>
                    <Sparkle className="h-3.5 w-3.5 text-teal-200" />
                    <span>Run Audit</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Local SEO Impact Simulator Widget */}
          <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Sliders className="h-4 w-4 text-teal-600" />
                <h3 className="text-xs font-bold text-slate-600 uppercase tracking-widest">
                  SEO Impact Simulator
                </h3>
              </div>
              <span className="text-[9px] font-mono bg-teal-50 text-teal-600 border border-teal-200 px-1.5 py-0.5 rounded font-bold">
                PROJECTIONS
              </span>
            </div>
            
            <p className="text-xs text-slate-500 leading-relaxed">
              Tweak indicators to visualize how prospective profile updates directly impact your estimated Local Rank Authority score.
            </p>

            {/* Score Projection Visual */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-4">
              <div>
                <p className="text-[9px] font-bold text-slate-450 uppercase tracking-widest">Projected Rating</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[18px] font-display font-black text-slate-800">
                    {simulatedScore}
                  </span>
                  <span className="text-slate-400 text-sm font-bold">/100</span>
                </div>
              </div>

              <div className="text-right">
                <span className={`text-[9px] px-2 py-0.5 rounded font-mono font-bold uppercase tracking-widest ${
                  simulatedScore >= 85 
                    ? "bg-teal-50 text-teal-700 border border-teal-200" 
                    : simulatedScore >= 65 
                      ? "bg-amber-50 text-amber-705 border border-amber-200" 
                      : "bg-rose-50 text-rose-700 border border-rose-200"
                }`}>
                  {simulatedScore >= 85 ? "Excellent" : simulatedScore >= 65 ? "Fair Rank" : "Weak Rank"}
                </span>
                <p className="text-[10px] text-slate-500 mt-1 leading-tight">algorithmic potential</p>
              </div>
            </div>

            {/* Controls */}
            <div className="space-y-3 pt-1">
              {/* Name spam check */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-700 flex items-center gap-1.5 font-medium">
                  🛡️ No Name Stuffing <span className="text-[9px] font-mono text-slate-400">(20%)</span>
                </span>
                <button
                  onClick={() => setSimNameCorrect(!simNameCorrect)}
                  className={`w-10 h-6 rounded-full transition-colors relative duration-300 ${simNameCorrect ? "bg-teal-600" : "bg-slate-200 border border-slate-300"}`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${simNameCorrect ? "left-5" : "left-1"}`}></div>
                </button>
              </div>

              {/* Category relevance */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-700 flex items-center gap-1.5 font-medium font-sans">
                  📂 Primary & Secondary Categories <span className="text-[9px] font-mono text-slate-400">(15%)</span>
                </span>
                <button
                  onClick={() => setSimCategoryMatch(!simCategoryMatch)}
                  className={`w-10 h-6 rounded-full transition-colors relative duration-300 ${simCategoryMatch ? "bg-teal-600" : "bg-slate-200 border border-slate-300"}`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${simCategoryMatch ? "left-5" : "left-1"}`}></div>
                </button>
              </div>

              {/* Description status */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-700 flex items-center gap-1.5 font-medium">
                  ✏️ Optimized 750-Char Description <span className="text-[9px] font-mono text-slate-400">(10%)</span>
                </span>
                <button
                  onClick={() => setSimDescOptimal(!simDescOptimal)}
                  className={`w-10 h-6 rounded-full transition-colors relative duration-300 ${simDescOptimal ? "bg-teal-600" : "bg-slate-200 border border-slate-300"}`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${simDescOptimal ? "left-5" : "left-1"}`}></div>
                </button>
              </div>

              {/* Photos & Visuals */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-700 flex items-center gap-1.5 font-medium">
                  📸 Recent Visual Assets <span className="text-[9px] font-mono text-slate-400">(15%)</span>
                </span>
                <button
                  onClick={() => setSimRecentPhotos(!simRecentPhotos)}
                  className={`w-10 h-6 rounded-full transition-colors relative duration-300 ${simRecentPhotos ? "bg-teal-600" : "bg-slate-200 border border-slate-300"}`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${simRecentPhotos ? "left-5" : "left-1"}`}></div>
                </button>
              </div>

              {/* Reply rate slider */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-slate-700 font-medium">
                  <span>💬 Review Reply Rate <span className="text-[9px] font-mono text-slate-400">(20%)</span></span>
                  <span className="font-mono text-teal-600 font-bold">{simReviewReplies}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={simReviewReplies}
                  onChange={(e) => setSimReviewReplies(Number(e.target.value))}
                  className="w-full accent-teal-600 h-1.5 bg-slate-100 rounded-lg cursor-pointer"
                />
              </div>

              {/* Posting activity */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-slate-700 font-medium">
                  <span>📰 Monthly Posts & Updates <span className="text-[9px] font-mono text-slate-400">(10%)</span></span>
                  <span className="font-mono text-teal-600 font-bold">{simPostingFrequency} / mo</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="8"
                  step="1"
                  value={simPostingFrequency}
                  onChange={(e) => setSimPostingFrequency(Number(e.target.value))}
                  className="w-full accent-teal-600 h-1.5 bg-slate-100 rounded-lg cursor-pointer"
                />
              </div>

              {/* Technical / attributes */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-700 flex items-center gap-1.5 font-medium font-sans">
                  ⚙️ Complete Attribute Checklist <span className="text-[9px] font-mono text-slate-400">(10%)</span>
                </span>
                <button
                  onClick={() => setSimAttributesComp(!simAttributesComp)}
                  className={`w-10 h-6 rounded-full transition-colors relative duration-300 ${simAttributesComp ? "bg-teal-600" : "bg-slate-200 border border-slate-300"}`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${simAttributesComp ? "left-5" : "left-1"}`}></div>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side / Middle Area: Audit Output and Search Progress */}
        <div className="lg:col-span-8 space-y-8">
          
          {/* History drawer widget if enabled */}
          {showHistory && (
            <div className="p-6 bg-white border border-slate-200 rounded-2xl shadow-sm no-print">
              <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4 text-teal-600" />
                  <h3 className="text-sm font-bold text-slate-750 uppercase tracking-widest font-sans">
                    History
                  </h3>
                </div>
                <button 
                  onClick={() => setShowHistory(false)}
                  className="text-xs text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>

              {history.length === 0 ? (
                <p className="text-slate-400 text-xs text-center py-6">No audits found.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[300px] overflow-y-auto pr-1">
                  {history.map((item) => (
                    <div 
                      key={item.id}
                      onClick={() => {
                        setReport(item.report);
                        setSources(item.sources);
                        setBusinessName(item.businessNameChecked);
                        setUrl(item.urlChecked);
                        setMapLocation(item.location || null);
                        setPlacesApiStatus(item.placesApiStatus || null);
                        setShowHistory(false);
                      }}
                      className="p-3 bg-slate-50 border border-slate-200 hover:border-teal-500/50 rounded-xl cursor-pointer transition-all flex justify-between items-start group"
                    >
                      <div className="space-y-1 min-w-0">
                        <h4 className="font-bold text-slate-800 text-xs truncate max-w-[170px] group-hover:text-teal-600">
                          {item.report.businessName}
                        </h4>
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                          <Clock className="h-3 w-3 inline" />
                          <span>{item.timestamp}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 font-mono ml-2 shrink-0">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                          item.report.overallScore >= 85 
                            ? "bg-teal-50 text-teal-700" 
                            : item.report.overallScore >= 65 
                              ? "bg-amber-50 text-amber-700" 
                              : "bg-rose-50 text-rose-700"
                        }`}>
                          {item.report.overallScore}
                        </span>
                        <button
                          onClick={(e) => deleteHistoryItem(item.id, e)}
                          className="text-slate-450 hover:text-rose-600 p-1 rounded hover:bg-rose-50 transition-colors cursor-pointer"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Loading Console Stage Area */}
          {loading && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-8 rounded-2xl bg-white border border-slate-200 shadow-sm flex flex-col items-center justify-center text-center space-y-5"
            >
              {/* Custom scanning animation node */}
              <div className="relative">
                <div className="h-20 w-20 rounded-full border-4 border-teal-500/10 border-t-teal-500 flex items-center justify-center animate-spin"></div>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center">
                  <Activity className="h-7 w-7 text-teal-600 animate-pulse" />
                </div>
              </div>

              <div className="space-y-1.5">
                <h4 className="font-display font-bold text-slate-800 text-base">Analyzing Profile</h4>
              </div>

              {/* Progress Bar */}
              <div className="w-full max-w-sm h-1.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                <div 
                  className="h-full bg-teal-500 transition-all duration-1000"
                  style={{ width: `${((loadingStep + 1) / loadingPhases.length) * 100}%` }}
                ></div>
              </div>

              {/* Step Logs Transition */}
              <div className="h-10 flex items-center justify-center">
                <AnimatePresence mode="wait">
                  <motion.p
                    key={loadingStep}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="text-xs text-slate-500 max-w-sm leading-relaxed font-medium"
                  >
                    {loadingPhases[loadingStep]}
                  </motion.p>
                </AnimatePresence>
              </div>
            </motion.div>
          )}

          {/* Prompting instruction when empty */}
          {!loading && !report && (
            <div className="p-12 rounded-2xl bg-white border border-slate-200 text-center space-y-4 shadow-sm flex flex-col items-center">
              <div className="h-12 w-12 rounded-full border border-slate-200 flex items-center justify-center text-slate-400 bg-slate-50 mb-1">
                <Compass className="h-6 w-6" />
              </div>
              <div className="space-y-1.5 max-w-sm">
                <h3 className="font-display font-semibold text-base text-slate-800">No Profile Selected</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Provide a shareable Google Business Profile link or search for a business name and city to begin.
                </p>
              </div>
            </div>
          )}

          {/* Core GBP Diagnostic Panel Output */}
          {report && !loading && (
            <motion.div
              ref={contentRef}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4 }}
              className={`space-y-8 ${isExporting ? "p-4 bg-slate-50" : ""}`}
            >
              {/* Executive Assessment Component - Light theme polished layout */}
              <div className="p-8 rounded-2xl bg-white border border-slate-200 shadow-sm relative overflow-hidden print-card">
                
                {/* Visual accent backdrop lines */}
                <div className="absolute top-0 right-0 w-64 h-64 bg-teal-500/5 rounded-full filter blur-3xl"></div>

                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 pb-6 border-b border-slate-200/80">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="p-1 rounded-lg bg-teal-50 text-teal-600">
                        <MapPin className="h-4 w-4" />
                      </span>
                      <span className="text-[10px] font-mono tracking-widest text-slate-400 uppercase font-bold mr-1">Analysis Profile</span>
                      
                      {placesApiStatus === "success" && (
                        <span className="px-2.5 py-0.5 rounded-md text-[9px] font-mono font-bold tracking-wider uppercase bg-emerald-50 text-emerald-700 border border-emerald-250 flex items-center gap-1.5 cursor-help" title="Real-time data fetched from Google Places API (100% accurate reviews, name, and address)">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                          <span>Places API: Connected</span>
                        </span>
                      )}
                      {placesApiStatus === "no_results" && (
                        <span className="px-2.5 py-0.5 rounded-md text-[9px] font-mono font-bold tracking-wider uppercase bg-amber-50 text-amber-700 border border-amber-250 flex items-center gap-1.5 cursor-help" title="Places API search returned 0 results. Fell back to Google Search Grounding. Data might be cached or outdated.">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
                          <span>Places API: No Match</span>
                        </span>
                      )}
                      {placesApiStatus === "api_error" && (
                        <span className="px-2.5 py-0.5 rounded-md text-[9px] font-mono font-bold tracking-wider uppercase bg-rose-50 text-rose-700 border-rose-250 flex items-center gap-1.5 cursor-help" title="Places API returned an HTTP error or failed to connect. Fell back to Google Search Grounding. Data might be cached or outdated.">
                          <span className="h-1.5 w-1.5 rounded-full bg-rose-500"></span>
                          <span>Places API: Error</span>
                        </span>
                      )}
                      {placesApiStatus === "missing_key" && (
                        <span className="px-2.5 py-0.5 rounded-md text-[9px] font-mono font-bold tracking-wider uppercase bg-slate-100 text-slate-500 border border-slate-200 flex items-center gap-1.5 cursor-help" title="No Google Maps API Key was detected in your environment. Fell back to Google Search Grounding. Map is disabled and review data may be cached or inconsistent.">
                          <span className="h-1.5 w-1.5 rounded-full bg-slate-400"></span>
                          <span>Places API: Inactive</span>
                        </span>
                      )}
                    </div>
                    <h2 className="text-2xl font-display font-black text-slate-950 tracking-tight leading-none pt-1">
                      {report.businessName}
                    </h2>
                    <p className="text-xs text-slate-400 line-clamp-1">{url || "Analyzed from Search"}</p>
                  </div>

                  {/* Actions Bar inside card */}
                  <div className={`flex items-center gap-2 shrink-0 ${isExporting ? "hidden" : "no-print"}`}>
                    <button
                      onClick={handleCopySummary}
                      className="p-2 bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-teal-600 transition-all text-xs flex items-center gap-1.5 cursor-pointer"
                      title="Copy overview text"
                    >
                      <Share2 className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Copy Text</span>
                    </button>
                    <button
                      onClick={handleTriggerPrint}
                      className="p-2 bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-teal-600 transition-all text-xs flex items-center gap-1.5 cursor-pointer"
                      title="Export report to PDF"
                    >
                      <Printer className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">{isExporting ? "Exporting..." : "Download PDF"}</span>
                    </button>
                  </div>
                </div>

                {/* Score and Summary Metrics */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-8 pt-6 items-center">
                  
                  {/* Gauge section */}
                  <div className="md:col-span-4 flex flex-col items-center justify-center p-4 bg-slate-50 border border-slate-200 rounded-2xl relative">
                    {/* Circular Score display SVG */}
                    <div className="relative w-40 h-40 flex items-center justify-center">
                      <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                        {/* Track ring */}
                        <circle
                          cx="50"
                          cy="50"
                          r="42"
                          stroke="currentColor"
                          strokeWidth="8"
                          fill="transparent"
                          className="text-slate-100"
                        />
                        {/* Progressive overlay */}
                        <circle
                          cx="50"
                          cy="50"
                          r="42"
                          stroke="currentColor"
                          strokeWidth="8"
                          strokeDasharray={263.8}
                          strokeDashoffset={263.8 - (263.8 * report.overallScore) / 100}
                          fill="transparent"
                          strokeLinecap="round"
                          className={`transition-all duration-1000 ${
                            report.overallScore >= 85 
                              ? "text-teal-500" 
                              : report.overallScore >= 65 
                                ? "text-amber-500" 
                                : "text-rose-500"
                          }`}
                        />
                      </svg>
                      {/* Inner numeric indicator */}
                      <div className="absolute flex flex-col items-center justify-center text-center">
                        <span className="text-4xl font-display font-black text-slate-800 leading-none">
                          {report.overallScore}
                        </span>
                        <span className="text-[9px] text-slate-400 font-mono tracking-widest font-bold uppercase mt-1">
                          Score / 100
                        </span>
                      </div>
                    </div>

                    <div className="text-center mt-3">
                      <span className={`text-[9px] uppercase font-mono font-bold tracking-widest px-2.5 py-0.5 rounded ${
                        report.overallScore >= 85 
                          ? "bg-teal-50 text-teal-700 border border-teal-200" 
                          : report.overallScore >= 65 
                            ? "bg-amber-50 text-amber-700 border border-amber-200" 
                            : "bg-rose-50 text-rose-700 border border-rose-200"
                      }`}>
                        {report.overallScore >= 85 ? "High Authority" : report.overallScore >= 65 ? "Fair Authority" : "Deficient Listing"}
                      </span>
                    </div>
                  </div>

                  {/* Summary Text section */}
                  <div className="md:col-span-8 space-y-4">
                    <h3 className="font-sans font-bold text-slate-400 text-[10px] uppercase tracking-widest font-mono">
                      Executive Summary & Assessment
                    </h3>
                    
                    {/* Dark teal beautiful background for executive block matches template view */}
                    <div className="bg-teal-900 text-teal-50 p-6 rounded-2xl shadow-sm space-y-2">
                      <p className="text-xs sm:text-sm leading-relaxed font-display">
                        "{report.summary}"
                      </p>
                    </div>

                    <div className="pt-2 grid grid-cols-3 gap-2 text-center text-[9px] font-mono font-semibold">
                      <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                        <span className="block text-slate-400 uppercase tracking-widest">Weights Applied</span>
                        <span className="text-slate-700 block text-xs mt-0.5">{report.sections.length} Local Pillars</span>
                      </div>
                      <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                        <span className="block text-slate-400 uppercase tracking-widest">Optimized Pillars</span>
                        <span className="text-teal-600 block text-xs mt-0.5">
                          {report.sections.filter(s => s.status === "Optimized").length} / {report.sections.length}
                        </span>
                      </div>
                      <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                        <span className="block text-slate-400 uppercase tracking-widest">Priority Gaps</span>
                        <span className="text-rose-600 block text-xs mt-0.5 font-bold">
                          {report.sections.filter(s => s.status !== "Optimized").length}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Grounded Sources Metadata Panel */}
              {sources.length > 0 && (
                <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-sm print-card">
                  <div className="flex items-center gap-2 mb-3">
                    <h4 className="text-[9px] font-mono font-bold tracking-widest text-slate-400 uppercase">
                      Sources
                    </h4>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {sources.map((item, idx) => (
                      <a
                        key={idx}
                        href={item.uri}
                        target="_blank"
                        rel="referrer noopener"
                        className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-teal-700 hover:text-teal-800 border border-slate-200 rounded-lg flex items-center gap-1.5 transition-all w-full sm:w-auto overflow-hidden text-ellipsis whitespace-nowrap cursor-pointer"
                      >
                        <ExternalLink className="h-3 w-3 inline shrink-0" />
                        <span className="truncate max-w-[200px] text-[11px] font-mono leading-none font-medium">{item.title}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Location Map View */}
              <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-sm print-card">
                 <div className="flex items-center gap-2 mb-3">
                    <MapPin className="h-4 w-4 text-slate-400" />
                    <h4 className="text-[9px] font-mono font-bold tracking-widest text-slate-400 uppercase">
                      Location Intelligence
                    </h4>
                  </div>
                  <LocationMap businessName={report.businessName} location={mapLocation || undefined} />
              </div>

              {/* 7 Weighted Criteria Sections Accordions */}
              <div className="space-y-4">
                <div className="flex justify-between items-center px-1">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest font-mono">
                    Diagnostic Score Breakdown
                  </h3>
                  <p className="text-[10px] text-slate-400 font-medium">Click categories to reveal detailed Local SEO directives</p>
                </div>

                {(() => {
                  const rankingSections = report.sections.filter(s => s.category === "Ranking Factor" || !s.category);
                  const bestPracticeSections = report.sections.filter(s => s.category === "Best Practice");

                  const renderSectionAccordion = (section: AuditSection, idx: number) => {
                    const isExpanded = expandedSection === section.title || isExporting;
                    
                    // Matching Icon
                    let matchIcon = <Layers className="h-4 w-4" />;
                    if (section.title.toLowerCase().includes("core") || section.title.toLowerCase().includes("nap")) matchIcon = <MapPin className="h-4 w-4" />;
                    if (section.title.toLowerCase().includes("category") || section.title.toLowerCase().includes("categories")) matchIcon = <Compass className="h-4 w-4" />;
                    if (section.title.toLowerCase().includes("description")) matchIcon = <FileText className="h-4 w-4" />;
                    if (section.title.toLowerCase().includes("visual") || section.title.toLowerCase().includes("photo")) matchIcon = <Image className="h-4 w-4" />;
                    if (section.title.toLowerCase().includes("review") || section.title.toLowerCase().includes("rating")) matchIcon = <MessageSquare className="h-4 w-4" />;
                    if (section.title.toLowerCase().includes("post") || section.title.toLowerCase().includes("update")) matchIcon = <Clock className="h-4 w-4" />;
                    if (section.title.toLowerCase().includes("technical") || section.title.toLowerCase().includes("attribute")) matchIcon = <Activity className="h-4 w-4" />;

                    // Status Badge - Colors matching template
                    let statusBadge = (
                      <span className="px-2 py-1 text-[10px] font-bold text-teal-600 bg-teal-50 rounded-md uppercase tracking-wider flex items-center gap-1">
                        <CheckCircle className="h-3.5 w-3.5 inline text-teal-600 shrink-0" />
                        <span>Optimized</span>
                      </span>
                    );
                    if (section.status === "Needs Improvement") {
                      statusBadge = (
                        <span className="px-2 py-1 text-[10px] font-bold text-amber-600 bg-amber-50 rounded-md uppercase tracking-wider flex items-center gap-1">
                          <AlertTriangle className="h-3.5 w-3.5 inline text-amber-500 shrink-0" />
                          <span>Needs Improvement</span>
                        </span>
                      );
                    } else if (section.status === "Missing") {
                      statusBadge = (
                        <span className="px-2 py-1 text-[10px] font-bold text-rose-600 bg-rose-50 rounded-md uppercase tracking-wider flex items-center gap-1">
                          <XCircle className="h-3.5 w-3.5 inline text-rose-500 shrink-0" />
                          <span>Missing</span>
                        </span>
                      );
                    }

                    // Custom border highlights based on status
                    const borderHighlightClass = 
                      section.status === "Optimized" 
                        ? "border-slate-200" 
                        : section.status === "Needs Improvement" 
                          ? "border-l-4 border-l-amber-400 border-slate-200" 
                          : "border-l-4 border-l-rose-500 border-slate-200";

                    return (
                      <div
                        key={section.title}
                        className={`bg-white rounded-xl shadow-sm transition-all duration-300 print-card border ${borderHighlightClass} ${
                          isExpanded ? "ring-1 ring-teal-500/20 shadow-md" : ""
                        }`}
                      >
                        {/* Header Trigger */}
                        <div
                          onClick={() => setExpandedSection(isExpanded ? null : section.title)}
                          className="p-4 sm:p-5 flex items-center justify-between gap-4 cursor-pointer select-none"
                        >
                          <div className="flex items-center gap-3.5 min-w-0 flex-1">
                            <span className={`p-2 rounded-lg shrink-0 transition-all ${
                              isExpanded ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-500"
                            }`}>
                              {matchIcon}
                            </span>
                            <div className="space-y-1 min-w-0">
                              <h4 className="font-display font-bold text-[13px] sm:text-base text-slate-800 tracking-tight truncate">
                                {section.title}
                              </h4>
                              <div className="flex items-center gap-2 flex-wrap">
                                {statusBadge}
                                <span className="text-[10px] text-slate-500 font-mono font-semibold">
                                  Standing: <span className="text-slate-700">{section.standing}</span>
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Score visual and Chevron */}
                          <div className="flex items-center gap-3 shrink-0">
                            <div className="text-right">
                              <div className="text-xs font-mono font-bold text-slate-700">
                                <span className={`text-base ${
                                  section.status === "Optimized" 
                                    ? "text-teal-600" 
                                    : section.status === "Needs Improvement" 
                                      ? "text-amber-600" 
                                      : "text-rose-600"
                                  }`}>
                                  {section.score}
                                </span>
                                <span className="text-slate-400 font-normal"> / {section.maxScore}</span>
                              </div>
                              {/* Horizontal metric line on header */}
                              <div className="w-14 h-1 bg-slate-100 rounded-full mt-1.5 overflow-hidden border border-slate-200/50">
                                <div 
                                  className={`h-full rounded-full ${
                                    section.status === "Optimized" 
                                      ? "bg-teal-500" 
                                      : section.status === "Needs Improvement" 
                                        ? "bg-amber-500" 
                                        : "bg-rose-500"
                                  }`}
                                  style={{ width: `${(section.score / section.maxScore) * 100}%` }}
                                ></div>
                              </div>
                            </div>

                            <span className={`text-slate-400 hover:text-slate-600 ${isExporting ? "hidden" : ""}`}>
                              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </span>
                          </div>
                        </div>

                        {/* Expandable Details Block */}
                        {isExpanded && (
                          <div className="px-5 pb-5 border-t border-slate-100 pt-4 space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
                              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/70 space-y-2">
                                <h5 className="font-mono font-bold text-[10px] text-teal-600 uppercase tracking-widest flex items-center gap-1">
                                  <BookOpen className="h-3.5 w-3.5 inline" />
                                  <span>Why It Affects Rank</span>
                                </h5>
                                <p className="text-slate-600 font-normal leading-relaxed">
                                  {section.whyItMatters}
                                </p>
                              </div>

                              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/70 space-y-2">
                                <h5 className="font-mono font-bold text-[10px] text-amber-605 uppercase tracking-widest flex items-center gap-1">
                                  <Sparkle className="h-3.5 w-3.5 inline" />
                                  <span>SEO Expert Recommendation</span>
                                </h5>
                                <p className="text-slate-600 font-normal leading-relaxed">
                                  {section.recommendation}
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  };

                  return (
                    <div className="space-y-8">
                      {/* Ranking Factors */}
                      {rankingSections.length > 0 && (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 py-2 text-slate-800">
                            <TrendingUp className="h-5 w-5 text-indigo-600" />
                            <h4 className="font-display font-bold text-lg">Core Ranking Factors</h4>
                          </div>
                          <div className="grid grid-cols-1 gap-3">
                            {rankingSections.map((section, idx) => renderSectionAccordion(section, idx))}
                          </div>
                        </div>
                      )}

                      {/* Best Practices */}
                      {bestPracticeSections.length > 0 && (
                        <div className="space-y-3 pt-4 border-t border-slate-200">
                          <div className="flex items-center gap-2 py-2 text-slate-800">
                            <Star className="h-5 w-5 text-amber-500 fill-amber-500/20" />
                            <h4 className="font-display font-bold text-lg">Best Practices & Conversions</h4>
                          </div>
                          <div className="grid grid-cols-1 gap-3">
                            {bestPracticeSections.map((section, idx) => renderSectionAccordion(section, idx))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Competitor Analysis Panel */}
              {report.competitors && report.competitors.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 px-1">
                    <span className="p-1 rounded-lg bg-indigo-50 text-indigo-600">
                      <Search className="h-4 w-4" />
                    </span>
                    <h3 className="font-display font-bold text-slate-800 text-lg">
                      Top Keyword Competitors
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {report.competitors.map((comp, idx) => (
                      <div key={idx} className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm print-card text-xs flex flex-col h-full">
                        <div className="flex justify-between items-start gap-2 mb-3 pb-3 border-b border-slate-100">
                          <div>
                            <h4 className="font-display font-bold text-[13px] text-slate-800 mb-1 leading-tight">
                              {comp.name}
                            </h4>
                            {comp.keywordsInName && (
                              <span className="inline-flex py-0.5 px-1.5 bg-rose-50 border border-rose-100 text-rose-600 text-[9px] font-bold uppercase tracking-widest rounded">
                                Keywords in Name
                              </span>
                            )}
                          </div>
                          <span className={`px-2 py-0.5 border rounded font-mono font-bold leading-none shrink-0 ${
                            comp.estimatedScore >= 85 ? "bg-teal-50 text-teal-700 border-teal-200" :
                            comp.estimatedScore >= 65 ? "bg-amber-50 text-amber-700 border-amber-200" :
                            "bg-rose-50 text-rose-700 border-rose-200"
                          }`}>
                            {comp.estimatedScore}
                          </span>
                        </div>
                        
                        <div className="flex-1 space-y-4">
                          <div className="space-y-1.5">
                            <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-widest flex items-center gap-1">
                              <Layers className="h-3 w-3" /> Categories
                            </span>
                            <div className="flex flex-wrap gap-1">
                              <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 font-medium rounded text-[10px]">
                                ★ {comp.primaryCategory}
                              </span>
                              {comp.secondaryCategories?.map((cat, ci) => (
                                <span key={ci} className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px]">
                                  {cat}
                                </span>
                              ))}
                            </div>
                          </div>

                          <div>
                            <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1 flex items-center gap-1">
                              <MessageSquare className="h-3 w-3" /> Review Velocity
                            </span>
                            <p className="text-slate-600 leading-snug font-sans">
                              {comp.reviewVelocity}
                            </p>
                          </div>

                          <div className="grid grid-cols-1 gap-3 pt-3 border-t border-slate-100">
                            <div>
                              <span className="block text-[10px] text-teal-600 font-bold uppercase tracking-widest mb-1 flex items-center gap-1">
                                <CheckCircle className="h-3 w-3" /> Advantage
                              </span>
                              <p className="text-slate-600 leading-snug font-sans truncate">
                                {comp.keyAdvantage}
                              </p>
                            </div>
                            <div>
                              <span className="block text-[10px] text-rose-500 font-bold uppercase tracking-widest mb-1 flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" /> Weakness
                              </span>
                              <p className="text-slate-600 leading-snug font-sans truncate">
                                {comp.weakness}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Plan Interactive Checklist Dashboard (Gamified UI) */}
              <div className="p-6 sm:p-8 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-5 print-card">
                <div className="flex items-center justify-between pb-4 border-b border-slate-150">
                  <div className="flex items-center gap-2">
                    <CheckSquare className="h-5 w-5 text-teal-600" />
                    <div>
                      <h3 className="font-display font-bold text-slate-800 text-lg">
                        Task List
                      </h3>
                      <p className="text-xs text-slate-500">Address these items to fully optimize your profile</p>
                    </div>
                  </div>
                  
                  {/* Score checklist increment */}
                  <span className="text-xs font-mono font-bold bg-teal-50 text-teal-700 px-2.5 py-1 rounded border border-teal-200">
                    {fixes.filter(f => f.completed).length} / {fixes.length} Tasks Fixed
                  </span>
                </div>

                {fixes.length === 0 ? (
                  <div className="p-4 bg-teal-50 rounded-xl border border-teal-150 flex items-center gap-2.5 text-teal-800 text-xs">
                    <CheckCircle className="h-4 w-4 text-teal-600 shrink-0" />
                    <span>Incredible standing! No deficient sections were uncovered during GBP evaluation. Your profile is in perfect local shape.</span>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {fixes.map((item) => (
                      <div 
                        key={item.id}
                        onClick={() => handleToggleFix(item.id)}
                        className={`p-3.5 rounded-xl border cursor-pointer select-none transition-all flex items-start gap-3 ${
                          item.completed 
                            ? "bg-slate-50 border-slate-200/50 text-slate-400 line-through" 
                            : "bg-slate-50 hover:bg-slate-100/70 border-slate-205 text-slate-700"
                        }`}
                      >
                        <span className={`shrink-0 mt-0.5 ${item.completed ? "text-teal-600" : "text-slate-400"}`}>
                          {item.completed ? (
                            <CheckCircle className="h-4.5 w-4.5 text-teal-600" />
                          ) : (
                            <div className="h-4.5 w-4.5 rounded border border-slate-300"></div>
                          )}
                        </span>
                        <span className="text-xs font-medium leading-snug">{item.text}</span>
                      </div>
                    ))}

                    {/* Completion success card if everything clicked */}
                    {fixes.length > 0 && fixes.every(f => f.completed) && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="p-5 bg-teal-900 text-teal-50 rounded-xl space-y-2 shadow-sm"
                      >
                        <div className="flex items-center gap-1.5">
                          <Sparkle className="h-4 w-4 text-teal-300 animate-pulse" />
                          <h5 className="font-display font-bold text-sm text-teal-300">Profile Optimized</h5>
                        </div>
                        <p className="text-[11px] text-teal-100 leading-relaxed">
                          Your chosen Google Business Profile is in great shape across all evaluated criteria.
                        </p>
                      </motion.div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          )}

        </div>
      </main>

      {/* Footer conforming to Professional Polish guidelines */}
      <footer className="max-w-7xl mx-auto mt-12 px-6 sm:px-8 border-t border-slate-200 py-6 flex justify-center items-center text-[10px] uppercase font-bold text-slate-400 tracking-wider">
        <span>© {new Date().getFullYear()} Circle Social</span>
      </footer>
    </div>
  );
}
