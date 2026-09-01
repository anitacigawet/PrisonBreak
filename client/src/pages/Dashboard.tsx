import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, FileText, FolderOpen, Loader2, Plus, Scale, Search, Filter } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { OnboardingTour, useOnboardingTour } from "@/components/OnboardingTour";
import { dashboardTourSteps } from "@/lib/tourSteps";

const CASE_TEMPLATES = [
  {
    id: "blank",
    label: "Blank Case",
    description: "Start from scratch",
    title: "",
    caseNumber: "",
    jurisdiction: "",
    charges: "",
  },
  {
    id: "wrongful_conviction",
    label: "Wrongful Conviction Appeal",
    description: "Post-conviction challenge based on new evidence or legal errors",
    title: "State v. [Defendant Name] — Wrongful Conviction Appeal",
    caseNumber: "CR-YYYY-XXXXX",
    jurisdiction: "[State] Court of Appeals",
    charges: "First-degree murder (original conviction)",
  },
  {
    id: "habeas_corpus",
    label: "Habeas Corpus Petition",
    description: "Challenge unlawful detention or constitutional violations",
    title: "[Petitioner Name] v. [Warden/State] — Habeas Corpus",
    caseNumber: "HC-YYYY-XXXXX",
    jurisdiction: "[State/Federal] District Court",
    charges: "Petition for Writ of Habeas Corpus — Constitutional violations during trial",
  },
  {
    id: "post_conviction",
    label: "Post-Conviction Relief",
    description: "Motion for new trial or sentence modification",
    title: "[Defendant Name] — Motion for Post-Conviction Relief",
    caseNumber: "PCR-YYYY-XXXXX",
    jurisdiction: "[State] Circuit Court",
    charges: "[Original charges] — Seeking new trial based on ineffective assistance of counsel",
  },
  {
    id: "innocence_claim",
    label: "Innocence Claim",
    description: "New DNA or forensic evidence supporting innocence",
    title: "State v. [Defendant Name] — Innocence Project Review",
    caseNumber: "IP-YYYY-XXXXX",
    jurisdiction: "[State] Superior Court",
    charges: "[Original charges] — New evidence supports actual innocence",
  },
  {
    id: "sentencing_review",
    label: "Sentencing Review",
    description: "Challenge disproportionate or improper sentencing",
    title: "[Defendant Name] — Sentencing Review",
    caseNumber: "SR-YYYY-XXXXX",
    jurisdiction: "[State] Court of Appeals",
    charges: "[Original charges] — Challenging sentence as disproportionate or procedurally improper",
  },
];

export default function Dashboard() {
  const { user, loading: authLoading } = useAuth();
  const { runTour, markTourComplete } = useOnboardingTour("dashboard");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newCaseData, setNewCaseData] = useState({
    title: "",
    caseNumber: "",
    jurisdiction: "",
    charges: "",
  });
  const [selectedTemplate, setSelectedTemplate] = useState<string>("blank");
  
  // Search, filter, and sort state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"date" | "name" | "status">("date");

  const { data: cases, isLoading: casesLoading, refetch } = trpc.cases.list.useQuery();
  const createCase = trpc.cases.create.useMutation({
    onSuccess: () => {
      toast.success("Case created successfully");
      setIsCreateDialogOpen(false);
      setNewCaseData({ title: "", caseNumber: "", jurisdiction: "", charges: "" });
      setSelectedTemplate("blank");
      refetch();
    },
    onError: (error) => {
      toast.error(`Failed to create case: ${error.message}`);
    },
  });

  if (authLoading || casesLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  const handleCreateCase = () => {
    if (!newCaseData.title.trim()) {
      toast.error("Case title is required");
      return;
    }

    createCase.mutate({
      title: newCaseData.title,
      caseNumber: newCaseData.caseNumber || undefined,
      jurisdiction: newCaseData.jurisdiction || undefined,
      charges: newCaseData.charges || undefined,
    });
  };
  
  // Filter, search, and sort cases
  const filteredAndSortedCases = cases
    ? cases
        .filter((c) => {
          // Search filter
          const matchesSearch =
            searchQuery === "" ||
            c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (c.caseNumber && c.caseNumber.toLowerCase().includes(searchQuery.toLowerCase()));
          
          // Status filter
          const matchesStatus = statusFilter === "all" || c.status === statusFilter;
          
          return matchesSearch && matchesStatus;
        })
        .sort((a, b) => {
          if (sortBy === "date") {
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          } else if (sortBy === "name") {
            return a.title.localeCompare(b.title);
          } else if (sortBy === "status") {
            return a.status.localeCompare(b.status);
          }
          return 0;
        })
    : [];
  
  // Calculate statistics
  const stats = {
    total: cases?.length || 0,
    completed: cases?.filter((c) => c.status === "completed").length || 0,
    analyzing: cases?.filter((c) => c.status === "analyzing").length || 0,
    pending: cases?.filter((c) => c.status === "pending").length || 0,
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="border-b border-border bg-card">
        <div className="container flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Scale className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold text-foreground">PrisonBreak</h1>
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">Welcome, {user?.name}</span>
          </div>
        </div>
      </header>

      <main className="container py-8">
        {/* Statistics Overview */}
        <div className="grid gap-4 md:grid-cols-4 mb-8">
          <Card className="glass-card gradient-border-subtle">
            <CardHeader className="pb-2">
              <CardDescription>Total Cases</CardDescription>
              <CardTitle className="text-3xl gradient-text">{stats.total}</CardTitle>
            </CardHeader>
          </Card>
          <Card className="glass-card gradient-border-subtle">
            <CardHeader className="pb-2">
              <CardDescription>Completed</CardDescription>
              <CardTitle className="text-3xl text-emerald-500">{stats.completed}</CardTitle>
            </CardHeader>
          </Card>
          <Card className="glass-card gradient-border-subtle">
            <CardHeader className="pb-2">
              <CardDescription>In Progress</CardDescription>
              <CardTitle className="text-3xl text-amber-500">{stats.analyzing}</CardTitle>
            </CardHeader>
          </Card>
          <Card className="glass-card gradient-border-subtle">
            <CardHeader className="pb-2">
              <CardDescription>Pending</CardDescription>
              <CardTitle className="text-3xl text-blue-500">{stats.pending}</CardTitle>
            </CardHeader>
          </Card>
        </div>
        
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold gradient-text">My Cases</h2>
            <p className="text-muted-foreground mt-1">
              Manage and analyze your legal cases
            </p>
          </div>

          <div className="flex items-center gap-4">
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button className="btn-glow">
                <Plus className="mr-2 h-4 w-4" />
                New Case
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader>
                <DialogTitle className="text-card-foreground">Create New Case</DialogTitle>
                <DialogDescription>
                  Choose a template or start from scratch. You can add documents after creation.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label className="text-card-foreground">Case Template</Label>
                  <Select value={selectedTemplate} onValueChange={(val) => {
                    setSelectedTemplate(val);
                    const template = CASE_TEMPLATES.find(t => t.id === val);
                    if (template && template.id !== "blank") {
                      setNewCaseData({
                        title: template.title,
                        caseNumber: template.caseNumber,
                        jurisdiction: template.jurisdiction,
                        charges: template.charges,
                      });
                    } else {
                      setNewCaseData({ title: "", caseNumber: "", jurisdiction: "", charges: "" });
                    }
                  }}>
                    <SelectTrigger className="w-full bg-input border-border text-foreground">
                      <SelectValue placeholder="Choose a template..." />
                    </SelectTrigger>
                    <SelectContent>
                      {CASE_TEMPLATES.map(t => (
                        <SelectItem key={t.id} value={t.id}>
                          <span className="font-medium">{t.label}</span>
                          {t.description && <span className="text-muted-foreground ml-2 text-xs">— {t.description}</span>}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="title" className="text-card-foreground">Case Title *</Label>
                  <Input
                    id="title"
                    placeholder="e.g., State v. John Doe"
                    value={newCaseData.title}
                    onChange={(e) => setNewCaseData({ ...newCaseData, title: e.target.value })}
                    className="bg-input border-border text-foreground"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="caseNumber" className="text-card-foreground">Case Number</Label>
                  <Input
                    id="caseNumber"
                    placeholder="e.g., CR-2024-12345"
                    value={newCaseData.caseNumber}
                    onChange={(e) => setNewCaseData({ ...newCaseData, caseNumber: e.target.value })}
                    className="bg-input border-border text-foreground"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="jurisdiction" className="text-card-foreground">Jurisdiction</Label>
                  <Input
                    id="jurisdiction"
                    placeholder="e.g., Superior Court of Arizona"
                    value={newCaseData.jurisdiction}
                    onChange={(e) => setNewCaseData({ ...newCaseData, jurisdiction: e.target.value })}
                    className="bg-input border-border text-foreground"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="charges" className="text-card-foreground">Charges</Label>
                  <Textarea
                    id="charges"
                    placeholder="e.g., First-degree murder, Armed robbery"
                    value={newCaseData.charges}
                    onChange={(e) => setNewCaseData({ ...newCaseData, charges: e.target.value })}
                    className="bg-input border-border text-foreground"
                    rows={3}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsCreateDialogOpen(false)}
                  disabled={createCase.isPending}
                >
                  Cancel
                </Button>
                <Button onClick={handleCreateCase} disabled={createCase.isPending}>
                  {createCase.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create Case
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        </div>
        
        {/* Search and Filter Controls */}
        <div className="mb-6 flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by case name or number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 glass-card border-border"
            />
          </div>
          <div className="flex gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-2 rounded-md glass-card border-border text-foreground cursor-pointer"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="analyzing">Analyzing</option>
              <option value="completed">Completed</option>
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as "date" | "name" | "status")}
              className="px-4 py-2 rounded-md glass-card border-border text-foreground cursor-pointer"
            >
              <option value="date">Sort by Date</option>
              <option value="name">Sort by Name</option>
              <option value="status">Sort by Status</option>
            </select>
          </div>
        </div>

        {!cases || cases.length === 0 ? (
          <Card className="bg-card border-border">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FolderOpen className="h-24 w-24 text-muted-foreground/40 mb-6" />
              <h3 className="text-lg font-semibold text-card-foreground mb-2">No cases yet</h3>
              <p className="text-sm text-muted-foreground mb-4 text-center max-w-md">
                Create your first case to start analyzing legal documents and identifying potential errors.
              </p>
              <Button onClick={() => setIsCreateDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create Your First Case
              </Button>
            </CardContent>
          </Card>
        ) : filteredAndSortedCases.length === 0 ? (
          <Card className="bg-card border-border">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold text-card-foreground mb-2">No cases found</h3>
              <p className="text-sm text-muted-foreground text-center max-w-md">
                No cases match your search criteria. Try adjusting your filters.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 stagger-children">
            {filteredAndSortedCases.map((caseItem) => (
              <Link key={caseItem.id} href={`/case/${caseItem.id}`}>
                <Card className="glass-card-enhanced gradient-border-visible card-lift cursor-pointer h-full">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-card-foreground line-clamp-2">
                            {caseItem.title}
                          </CardTitle>
                          {caseItem.caseNumber && (
                            <CardDescription className="mt-1">
                              {caseItem.caseNumber}
                            </CardDescription>
                          )}
                        </div>
                        <StatusBadge status={caseItem.status} />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 text-sm">
                        {caseItem.jurisdiction && (
                          <div className="text-muted-foreground">
                            <span className="font-medium">Jurisdiction:</span> {caseItem.jurisdiction}
                          </div>
                        )}
                        <div className="text-muted-foreground text-xs">
                          Created {new Date(caseItem.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
      <OnboardingTour steps={dashboardTourSteps} run={runTour} onFinish={markTourComplete} />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const statusConfig = {
    pending: { label: "Pending", className: "status-badge-pending" },
    analyzing: { label: "Analyzing", className: "status-badge-active" },
    completed: { label: "Completed", className: "status-badge-completed" },
    error: { label: "Error", className: "status-badge-failed" },
  };

  const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;

  return (
    <span className={config.className}>
      {config.label}
    </span>
  );
}
