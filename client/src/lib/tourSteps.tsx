import { Step } from "react-joyride";

// Home page tour steps
export const homeTourSteps: Step[] = [
  {
    target: "body",
    content: (
      <div>
        <h3 className="text-lg font-bold mb-2">Welcome to PrisonBreak! ✨</h3>
        <p>
          Let's take a quick tour to show you how our AI-powered legal case analysis platform works.
          We'll walk you through the key features step by step.
        </p>
      </div>
    ),
    placement: "center",
    disableBeacon: true,
  },
  {
    target: ".gradient-text",
    content: (
      <div>
        <h3 className="text-lg font-bold mb-2">Clear and Easy to Read</h3>
        <p>
          Important headings and titles are highlighted to help you quickly find what you need.
          Everything is designed to be easy to read and understand.
        </p>
      </div>
    ),
    placement: "bottom",
  },
  {
    target: ".glass-card-enhanced:first-of-type",
    content: (
      <div>
        <h3 className="text-lg font-bold mb-2">Feature Cards</h3>
        <p>
          Each card explains a different feature of the platform. Hover your mouse over any card
          to see it highlight - this helps you know it's clickable!
        </p>
      </div>
    ),
    placement: "top",
  },
  {
    target: ".btn-glow",
    content: (
      <div>
        <h3 className="text-lg font-bold mb-2">Get Started</h3>
        <p>
          Click this button to go to your dashboard where you can create and manage your legal cases.
          The button lights up when you hover over it to show it's ready to click!
        </p>
      </div>
    ),
    placement: "top",
  },
];

// Dashboard tour steps
export const dashboardTourSteps: Step[] = [
  {
    target: "body",
    content: (
      <div>
        <h3 className="text-lg font-bold mb-2">Your Dashboard 📊</h3>
        <p>
          This is your command center for managing legal cases. Let's explore the key features!
        </p>
      </div>
    ),
    placement: "center",
    disableBeacon: true,
  },
  {
    target: ".gradient-text",
    content: (
      <div>
        <h3 className="text-lg font-bold mb-2">Your Cases</h3>
        <p>
          All your cases are displayed here in easy-to-read cards.
          Each card shows the case status, location (jurisdiction), and when it was created.
        </p>
      </div>
    ),
    placement: "bottom",
  },
  {
    target: ".btn-glow",
    content: (
      <div>
        <h3 className="text-lg font-bold mb-2">Create New Case</h3>
        <p>
          Click this button to create a new case. You'll enter basic information like the case name,
          case number, location, and charges. It only takes a minute!
        </p>
      </div>
    ),
    placement: "left",
  },
  {
    target: ".glass-card-enhanced:first-of-type",
    content: (
      <div>
        <h3 className="text-lg font-bold mb-2">Case Cards</h3>
        <p>
          Each case is shown as a card with all the important details. Click any card to open it
          and see full details, upload documents, and run the AI analysis.
        </p>
      </div>
    ),
    placement: "top",
  },
  {
    target: ".status-badge-pending, .status-badge-active, .status-badge-completed",
    content: (
      <div>
        <h3 className="text-lg font-bold mb-2">Status Indicators</h3>
        <p>
          Color-coded badges show you where each case is in the process:
          Blue means waiting to start, Cyan means analysis in progress, and Green means completed.
        </p>
      </div>
    ),
    placement: "bottom",
  },
];

// Case Detail tour steps
export const caseDetailTourSteps: Step[] = [
  {
    target: "body",
    content: (
      <div>
        <h3 className="text-lg font-bold mb-2">Case Detail View 📁</h3>
        <p>
          This is where you'll upload documents, run the AI analysis, and review the findings.
          Let's walk through how it works!
        </p>
      </div>
    ),
    placement: "center",
    disableBeacon: true,
  },
  {
    target: ".gradient-text",
    content: (
      <div>
        <h3 className="text-lg font-bold mb-2">Case Information</h3>
        <p>
          The case name is shown at the top, along with the case number,
          location (jurisdiction), and current status.
        </p>
      </div>
    ),
    placement: "bottom",
  },
  {
    target: '[role="tablist"]',
    content: (
      <div>
        <h3 className="text-lg font-bold mb-2">Navigation Tabs</h3>
        <p>
          Click these tabs to switch between different sections: Documents, Timeline, Analysis, Errors, and Usage.
          Each tab shows you different information about your case.
        </p>
      </div>
    ),
    placement: "bottom",
  },
  {
    target: ".glass-card-enhanced.gradient-border-visible.glow-hover",
    content: (
      <div>
        <h3 className="text-lg font-bold mb-2">Upload Documents</h3>
        <p>
          Drag and drop your files here (PDF, Word, or text files), or click to browse your computer.
          You can upload multiple files at once. The area lights up when you hover over it!
        </p>
      </div>
    ),
    placement: "top",
  },
  {
    target: '[id*="trigger-timeline"]',
    content: (
      <div>
        <h3 className="text-lg font-bold mb-2">Timeline View</h3>
        <p>
          The Timeline tab shows everything that's happened with your case in order:
          when documents were uploaded, analysis stages, and errors found. Great for tracking progress!
        </p>
      </div>
    ),
    placement: "bottom",
  },
  {
    target: '[id*="trigger-analysis"]',
    content: (
      <div>
        <h3 className="text-lg font-bold mb-2">AI Analysis</h3>
        <p>
          After uploading documents, click here to run the AI analysis. You'll see progress updates in real-time
          and detailed findings including legal research, potential errors, and recommendations.
        </p>
      </div>
    ),
    placement: "bottom",
  },
  {
    target: '[id*="trigger-errors"]',
    content: (
      <div>
        <h3 className="text-lg font-bold mb-2">Error Detection</h3>
        <p>
          View all potential legal errors the AI found, organized by category: Eyewitness Problems,
          Forensic Science Issues, False Confessions, Official Misconduct, and Inadequate Defense.
        </p>
      </div>
    ),
    placement: "bottom",
  },
  {
    target: '[id*="trigger-usage"]',
    content: (
      <div>
        <h3 className="text-lg font-bold mb-2">Usage Tracking</h3>
        <p>
          See how much processing was done for your analysis. You'll get a breakdown
          by each stage showing tokens used and processing details.
        </p>
      </div>
    ),
    placement: "bottom",
  },
];

