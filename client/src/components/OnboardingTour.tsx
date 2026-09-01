import { useState, useEffect } from "react";
import Joyride, { CallBackProps, STATUS, Step, Styles } from "react-joyride";
import { Button } from "@/components/ui/button";
import { X, Sparkles } from "lucide-react";

interface OnboardingTourProps {
  steps: Step[];
  run?: boolean;
  onFinish?: () => void;
}

export function OnboardingTour({ steps, run = true, onFinish }: OnboardingTourProps) {
  const [runTour, setRunTour] = useState(run);

  useEffect(() => {
    setRunTour(run);
  }, [run]);

  const handleJoyrideCallback = (data: CallBackProps) => {
    const { status } = data;
    const finishedStatuses: string[] = [STATUS.FINISHED, STATUS.SKIPPED];

    if (finishedStatuses.includes(status)) {
      setRunTour(false);
      onFinish?.();
    }
  };

  // Custom styles matching NeoCities aesthetic
  const customStyles: Partial<Styles> = {
    options: {
      zIndex: 10000,
      arrowColor: "rgba(255, 255, 255, 0.1)",
      backgroundColor: "rgba(15, 15, 20, 0.95)",
      overlayColor: "rgba(0, 0, 0, 0.7)",
      primaryColor: "oklch(0.6 0.25 264)",
      textColor: "oklch(0.95 0.005 250)",
      width: 380,
    },
    tooltip: {
      borderRadius: "12px",
      padding: 0,
      background: "rgba(15, 15, 20, 0.95)",
      backdropFilter: "blur(20px)",
      border: "1px solid rgba(255, 255, 255, 0.1)",
      boxShadow: `
        0 0 20px oklch(0.6 0.25 264 / 0.3),
        0 0 40px oklch(0.6 0.25 264 / 0.2),
        0 8px 32px rgba(0, 0, 0, 0.4)
      `,
    },
    tooltipContainer: {
      textAlign: "left",
    },
    tooltipTitle: {
      fontSize: "18px",
      fontWeight: "700",
      marginBottom: "12px",
      padding: "20px 20px 0",
      background: "linear-gradient(135deg, oklch(0.7 0.25 264) 0%, oklch(0.75 0.2 300) 50%, oklch(0.8 0.18 320) 100%)",
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
      WebkitTextFillColor: "transparent",
    },
    tooltipContent: {
      padding: "0 20px 20px",
      fontSize: "14px",
      lineHeight: "1.6",
      color: "oklch(0.85 0.005 250)",
    },
    tooltipFooter: {
      padding: "16px 20px",
      borderTop: "1px solid rgba(255, 255, 255, 0.1)",
      marginTop: "12px",
    },
    buttonNext: {
      background: "linear-gradient(135deg, oklch(0.6 0.25 264) 0%, oklch(0.65 0.2 300) 100%)",
      borderRadius: "8px",
      padding: "8px 16px",
      fontSize: "14px",
      fontWeight: "600",
      border: "none",
      boxShadow: "0 0 15px oklch(0.6 0.25 264 / 0.4)",
      transition: "all 0.3s ease",
    },
    buttonBack: {
      color: "oklch(0.75 0.005 250)",
      marginRight: "8px",
      fontSize: "14px",
      fontWeight: "500",
    },
    buttonSkip: {
      color: "oklch(0.65 0.005 250)",
      fontSize: "14px",
      fontWeight: "500",
    },
    buttonClose: {
      display: "none", // We'll use custom close button
    },
    beacon: {
      background: "linear-gradient(135deg, oklch(0.6 0.25 264) 0%, oklch(0.65 0.2 300) 100%)",
      boxShadow: `
        0 0 15px oklch(0.6 0.25 264 / 0.6),
        0 0 30px oklch(0.6 0.25 264 / 0.4)
      `,
    },
    beaconInner: {
      background: "oklch(0.7 0.25 264)",
    },
    beaconOuter: {
      background: "oklch(0.6 0.25 264 / 0.3)",
      border: "2px solid oklch(0.6 0.25 264)",
    },
  };

  return (
    <Joyride
      steps={steps}
      run={runTour}
      continuous
      showProgress
      showSkipButton
      callback={handleJoyrideCallback}
      styles={customStyles}
      locale={{
        back: "Back",
        close: "Close",
        last: "Finish Tour",
        next: "Next",
        skip: "Skip Tour",
      }}
      floaterProps={{
        disableAnimation: false,
        styles: {
          arrow: {
            length: 8,
            spread: 12,
          },
        },
      }}
    />
  );
}

// Hook to manage tour state with localStorage
export function useOnboardingTour(tourKey: string) {
  const [hasSeenTour, setHasSeenTour] = useState(true);
  const [runTour, setRunTour] = useState(false);

  useEffect(() => {
    const seen = localStorage.getItem(`onboarding_tour_${tourKey}`);
    if (!seen) {
      setHasSeenTour(false);
      // Delay tour start slightly to let page render
      setTimeout(() => setRunTour(true), 500);
    }
  }, [tourKey]);

  const markTourComplete = () => {
    localStorage.setItem(`onboarding_tour_${tourKey}`, "true");
    setHasSeenTour(true);
    setRunTour(false);
  };

  const restartTour = () => {
    setRunTour(true);
  };

  return {
    hasSeenTour,
    runTour,
    markTourComplete,
    restartTour,
  };
}

// Tour trigger button component
export function TourTriggerButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      className="glass-card-enhanced gradient-border-visible"
    >
      <Sparkles className="h-4 w-4 mr-2" />
      Take Tour
    </Button>
  );
}
