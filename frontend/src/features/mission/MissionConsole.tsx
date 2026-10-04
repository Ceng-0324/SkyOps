import { useEffect, useState } from "react";

import { API_BASE_URL } from "../../api/client";
import { fetchBackendHealth } from "../../api/health";
import {
  DEFAULT_SCENARIO_ID,
  DEFAULT_TASK_INPUT,
  type IncidentEvent,
  createMissionPlan,
  createMissionReview,
  createReplanDecision,
} from "../../api/mission";
import { EvaluationSummaryPanel } from "../evaluation/EvaluationSummaryPanel";
import { BackendStatus } from "./BackendStatus";
import { EnvironmentDronePanel } from "./EnvironmentDronePanel";
import { HumanExplanationPanel } from "./HumanExplanationPanel";
import { IncidentReplanPanel } from "./IncidentReplanPanel";
import { IncidentControlPanel, MissionInputPanel } from "./MissionInputPanel";
import { MissionPlanPanel } from "./MissionPlanPanel";
import { MissionReviewPanel } from "./MissionReviewPanel";
import {
  ActiveViewHeader,
  MissionFlowSidebar,
  consoleViews,
  type ConsoleViewId,
} from "./MissionWorkspaceChrome";
import { RiskPanel } from "./RiskPanel";
import { RiskChartsPanel } from "./RiskChartsPanel";
import { SafetyThresholdPanel } from "./SafetyThresholdPanel";
import { SandboxMapPanel } from "./SandboxMapPanel";
import { StatusStrip } from "./StatusStrip";
import { DataSourceBadge } from "./components/DataSourceBadge";
import { formatCheckEndpoint, missionConsoleCopy, type Locale } from "./i18n";
import { incidentPresets } from "./incidentPresets";
import type { HealthState, MissionCycleState } from "./types";
import { badgeStyles, buttonStyles, cn, layoutStyles, textStyles } from "./uiTokens";

function LanguageToggle({
  locale,
  label,
  onLocaleChange,
}: {
  locale: Locale;
  label: string;
  onLocaleChange: (locale: Locale) => void;
}) {
  const languageOptions: Array<{ label: string; value: Locale }> = [
    { label: "中文", value: "zh" },
    { label: "EN", value: "en" },
  ];

  return (
    <div aria-label={label} className="flex items-center gap-2" role="group">
      <span className={cn(textStyles.label, "hidden sm:inline")}>{label}</span>
      <div className="flex border border-zinc-800 bg-zinc-950 p-1">
        {languageOptions.map((option) => {
          const isActive = locale === option.value;

          return (
            <button
              aria-pressed={isActive}
              className={cn(
                buttonStyles.base,
                "h-8 px-3 text-xs font-semibold",
                isActive
                  ? "bg-teal-300 text-zinc-950"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100",
              )}
              key={option.value}
              onClick={() => onLocaleChange(option.value)}
              type="button"
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const healthOfflineMessage =
  "Mission autonomy backend is unavailable. Keep the current plan in review mode until the service is reachable.";

const missionFailureMessage =
  "Mission decision loop is temporarily unavailable. No flight recommendation was generated for this request.";

const missionFailurePossibleCauses = [
  "The FastAPI backend is not running or the API endpoint is unreachable.",
  "The mission planning, replanning, or review endpoint returned an invalid response.",
  "The current mock scenario is unavailable or does not match the frontend contract.",
];

export function MissionConsole({ initialTaskInput, onTaskInputChange }: {
  initialTaskInput?: string;
  onTaskInputChange?: (input: string) => void;
} = {}) {
  const [locale, setLocale] = useState<Locale>("zh");
  const [health, setHealth] = useState<HealthState>({ status: "loading" });
  const [taskInput, setTaskInput] = useState(initialTaskInput ?? DEFAULT_TASK_INPUT);
  useEffect(() => { onTaskInputChange?.(taskInput); }, [taskInput, onTaskInputChange]);
  const [selectedIncident, setSelectedIncident] = useState(incidentPresets[0].event);
  const [missionCycle, setMissionCycle] = useState<MissionCycleState>({ status: "idle" });
  const [activeViewId, setActiveViewId] = useState<ConsoleViewId>("task");
  const [isIncidentUpdating, setIsIncidentUpdating] = useState(false);
  const [incidentUpdateError, setIncidentUpdateError] = useState<string | null>(null);
  const activeView = consoleViews.find((view) => view.id === activeViewId) ?? consoleViews[0];
  const copy = missionConsoleCopy[locale];
  const configuredApiEndpoint = API_BASE_URL === "" ? copy.backendFallback : API_BASE_URL;
  const missionFailureSuggestedActions = [
    formatCheckEndpoint(locale, configuredApiEndpoint),
    "Restart the backend service and run the mission loop again.",
    "Pause execution and request manual review before using this task plan.",
  ];

  function refreshBackendHealth() {
    setHealth({ status: "loading" });

    fetchBackendHealth()
      .then((data) => setHealth({ status: "online", data }))
      .catch((error: unknown) => {
        console.warn("Backend health check failed.", error);
        setHealth({
          status: "offline",
          message: healthOfflineMessage,
        });
      });
  }

  useEffect(() => {
    let isMounted = true;

    fetchBackendHealth()
      .then((data) => {
        if (isMounted) {
          setHealth({ status: "online", data });
        }
      })
      .catch((error: unknown) => {
        if (isMounted) {
          console.warn("Backend health check failed.", error);
          setHealth({
            status: "offline",
            message: healthOfflineMessage,
          });
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  async function runMissionCycle(incidentEvent: IncidentEvent = selectedIncident): Promise<boolean> {
    setSelectedIncident(incidentEvent);
    setMissionCycle({ status: "loading" });
    setIsIncidentUpdating(false);
    setIncidentUpdateError(null);

    try {
      const plan = await createMissionPlan({
        raw_user_input: taskInput,
        scenario_id: DEFAULT_SCENARIO_ID,
      });
      const replan = await createReplanDecision({
        scenario_id: DEFAULT_SCENARIO_ID,
        incident_event: incidentEvent,
      });
      const review = await createMissionReview({
        scenario_id: DEFAULT_SCENARIO_ID,
        incident_events: [incidentEvent],
      });

      setMissionCycle({ status: "ready", plan, replan, review, incidentEvent });
      return true;
    } catch (error: unknown) {
      console.error("Mission decision loop failed.", error);
      setMissionCycle({
        status: "failed",
        message: missionFailureMessage,
        possibleCauses: missionFailurePossibleCauses,
        suggestedActions: missionFailureSuggestedActions,
      });
      return false;
    }
  }

  async function handleGenerateMissionPlan() {
    const isReady = await runMissionCycle();

    if (isReady) {
      setActiveViewId("plan");
    }
  }

  async function handleIncidentSelect(incidentEvent: IncidentEvent) {
    if (missionCycle.status !== "ready") {
      return;
    }

    const previousIncident = selectedIncident;
    setSelectedIncident(incidentEvent);
    setIsIncidentUpdating(true);
    setIncidentUpdateError(null);

    try {
      const [replan, review] = await Promise.all([
        createReplanDecision({
          scenario_id: DEFAULT_SCENARIO_ID,
          incident_event: incidentEvent,
        }),
        createMissionReview({
          scenario_id: DEFAULT_SCENARIO_ID,
          incident_events: [incidentEvent],
        }),
      ]);

      setMissionCycle((currentCycle) => {
        if (currentCycle.status !== "ready") {
          return currentCycle;
        }

        return {
          status: "ready",
          plan: currentCycle.plan,
          replan,
          review,
          incidentEvent,
        };
      });
    } catch (error: unknown) {
      console.error("Incident replan or review update failed.", error);
      setSelectedIncident(previousIncident);
      setIncidentUpdateError(
        "Incident update failed. The previous mission plan and active incident are preserved for manual review.",
      );
    } finally {
      setIsIncidentUpdating(false);
    }
  }

  function renderActiveView() {
    if (activeViewId === "task") {
      return (
        <section className={layoutStyles.fullWidthGrid}>
          <MissionInputPanel
            locale={locale}
            missionCycle={missionCycle}
            taskInput={taskInput}
            isIncidentUpdating={isIncidentUpdating}
            onRun={() => void handleGenerateMissionPlan()}
            onTaskInputChange={setTaskInput}
          />
        </section>
      );
    }

    if (activeViewId === "plan") {
      return (
        <section className={layoutStyles.fullWidthGrid}>
          <MissionPlanPanel locale={locale} missionCycle={missionCycle} />
          <SandboxMapPanel locale={locale} missionCycle={missionCycle} />
          <section className={layoutStyles.secondaryGrid}>
            <EnvironmentDronePanel locale={locale} missionCycle={missionCycle} />
            <SafetyThresholdPanel locale={locale} missionCycle={missionCycle} />
          </section>
        </section>
      );
    }

    if (activeViewId === "risk") {
      return (
        <section className={layoutStyles.fullWidthGrid}>
          <RiskPanel locale={locale} missionCycle={missionCycle} />
          <RiskChartsPanel locale={locale} missionCycle={missionCycle} />
          <HumanExplanationPanel locale={locale} missionCycle={missionCycle} />
        </section>
      );
    }

    if (activeViewId === "incident") {
      return (
        <section className={layoutStyles.secondaryGrid}>
          <IncidentControlPanel
            locale={locale}
            missionCycle={missionCycle}
            selectedIncident={selectedIncident}
            isIncidentUpdating={isIncidentUpdating}
            incidentUpdateError={incidentUpdateError}
            onIncidentSelect={handleIncidentSelect}
          />
          <IncidentReplanPanel locale={locale} missionCycle={missionCycle} />
        </section>
      );
    }

    return (
      <section className={layoutStyles.fullWidthGrid}>
        <MissionReviewPanel locale={locale} missionCycle={missionCycle} />
        <RiskChartsPanel locale={locale} missionCycle={missionCycle} variant="review" />
        <HumanExplanationPanel locale={locale} missionCycle={missionCycle} />
      </section>
    );
  }

  return (
    <main className={layoutStyles.page}>
      <section className={layoutStyles.shell}>
        <header className={layoutStyles.header}>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn(badgeStyles.base, badgeStyles.brand, "tracking-[0.18em]")}>
                {copy.appBadge}
              </span>
              <DataSourceBadge locale={locale} sourceType="mock" label={copy.dataBadge} />
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-normal text-white md:text-4xl">
              {copy.pageTitle}
            </h1>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <LanguageToggle
              label={copy.languageLabel}
              locale={locale}
              onLocaleChange={setLocale}
            />
            <BackendStatus health={health} locale={locale} onRetry={refreshBackendHealth} />
          </div>
        </header>

        <StatusStrip copy={copy.status} health={health} locale={locale} missionCycle={missionCycle} />

        <section className={layoutStyles.workspaceGrid}>
          <MissionFlowSidebar
            activeView={activeViewId}
            copy={copy.workspace}
            locale={locale}
            missionCycle={missionCycle}
            onViewChange={setActiveViewId}
          />
          <div className="grid min-w-0 gap-5">
            <ActiveViewHeader
              activeView={activeView}
              copy={copy.workspace}
              locale={locale}
              missionCycle={missionCycle}
            />
            {renderActiveView()}
          </div>
        </section>

        <EvaluationSummaryPanel locale={locale} />
      </section>
    </main>
  );
}
