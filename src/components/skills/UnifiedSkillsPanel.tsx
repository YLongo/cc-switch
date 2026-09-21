import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Sparkles,
  Trash2,
  ExternalLink,
  RefreshCw,
  Loader2,
  Search,
  FolderUp,
  FolderGit2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  type ImportSkillSelection,
  type SkillBackupEntry,
  useDeleteSkillBackup,
  useInstalledSkills,
  useSkillBackups,
  useRestoreSkillBackup,
  useBulkToggleSkillApp,
  useToggleSkillApp,
  useUninstallSkill,
  useScanUnmanagedSkills,
  useImportSkillsFromApps,
  useInstallSkillsFromZip,
  useCheckSkillUpdates,
  useUpdateSkill,
  useDeploySkillToProject,
  useUndeploySkillFromProject,
  type InstalledSkill,
  type SkillUpdateInfo,
} from "@/hooks/useSkills";
import type { SkillUpdateStatus } from "@/lib/api/skills";
import type { AppId } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { extractErrorMessage } from "@/utils/errorUtils";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { settingsApi, skillsApi } from "@/lib/api";
import { toast } from "sonner";
import { SKILLS_APP_IDS } from "@/config/appConfig";
import { AppCountBar } from "@/components/common/AppCountBar";
import { AppToggleGroup } from "@/components/common/AppToggleGroup";
import { ListItemRow } from "@/components/common/ListItemRow";
import { ManagementListSearch } from "@/components/common/ManagementListSearch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const IMPORT_SKILLS_APP_IDS = SKILLS_APP_IDS.filter((app) => app !== "pi");

interface UnifiedSkillsPanelProps {
  onOpenDiscovery: () => void;
  currentApp: AppId;
  onInteractionBlockedChange?: (blocked: boolean) => void;
  onNavigationBlockedChange?: (blocked: boolean) => void;
  onCheckUpdatesStateChange?: (state: SkillsCheckUpdatesState) => void;
}

export interface SkillsCheckUpdatesState {
  isChecking: boolean;
  hasSkills: boolean;
}

export interface UnifiedSkillsPanelHandle {
  openDiscovery: () => void;
  openImport: () => void;
  openInstallFromZip: () => void;
  openRestoreFromBackup: () => void;
  checkUpdates: () => void;
}

function formatSkillBackupDate(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  return Number.isNaN(date.getTime())
    ? String(unixSeconds)
    : date.toLocaleString();
}

const UnifiedSkillsPanel = React.forwardRef<
  UnifiedSkillsPanelHandle,
  UnifiedSkillsPanelProps
>((props, ref) => {
  const {
    onOpenDiscovery,
    currentApp,
    onInteractionBlockedChange,
    onNavigationBlockedChange,
    onCheckUpdatesStateChange,
  } = props;
  const { t } = useTranslation();
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    variant?: "destructive" | "info";
    onConfirm: () => void;
  } | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [deployDialogSkill, setDeployDialogSkill] =
    useState<InstalledSkill | null>(null);
  const [batchDeployOpen, setBatchDeployOpen] = useState(false);
  const deployProjectMutation = useDeploySkillToProject();
  const undeployProjectMutation = useUndeploySkillFromProject();
  const [searchQuery, setSearchQuery] = useState("");
  const [writePending, setWritePending] = useState(false);
  const writeLockRef = React.useRef(false);
  const checkUpdatesLockRef = React.useRef(false);

  const { data: skills, isLoading } = useInstalledSkills();
  const {
    data: skillBackups = [],
    refetch: refetchSkillBackups,
    isFetching: isFetchingSkillBackups,
  } = useSkillBackups();
  const deleteBackupMutation = useDeleteSkillBackup();
  const toggleAppMutation = useToggleSkillApp();
  const bulkToggleAppMutation = useBulkToggleSkillApp();
  const uninstallMutation = useUninstallSkill();
  const restoreBackupMutation = useRestoreSkillBackup();
  // enabled: true —— 进入 Skill 页面时自动静默扫描一次（绿点提示来源）
  const { data: unmanagedSkills, refetch: scanUnmanaged } =
    useScanUnmanagedSkills({ enabled: true });
  const importMutation = useImportSkillsFromApps();
  const installFromZipMutation = useInstallSkillsFromZip();
  const {
    data: skillUpdates,
    refetch: checkUpdates,
    isFetching: isCheckingUpdates,
  } = useCheckSkillUpdates();
  const updateSkillMutation = useUpdateSkill();
  const [isUpdatingAll, setIsUpdatingAll] = useState(false);
  const visibleSkillAppIds =
    currentApp === "pi" ? SKILLS_APP_IDS : IMPORT_SKILLS_APP_IDS;

  const mutationPending =
    deleteBackupMutation.isPending ||
    toggleAppMutation.isPending ||
    bulkToggleAppMutation.isPending ||
    uninstallMutation.isPending ||
    restoreBackupMutation.isPending ||
    importMutation.isPending ||
    installFromZipMutation.isPending ||
    updateSkillMutation.isPending ||
    isUpdatingAll;
  const dialogOpen =
    importDialogOpen || restoreDialogOpen || confirmDialog !== null;
  const navigationBlocked = writePending || mutationPending || dialogOpen;
  const interactionBlocked = navigationBlocked || isCheckingUpdates;

  React.useEffect(() => {
    onInteractionBlockedChange?.(interactionBlocked);
  }, [interactionBlocked, onInteractionBlockedChange]);

  React.useEffect(() => {
    onNavigationBlockedChange?.(navigationBlocked);
  }, [navigationBlocked, onNavigationBlockedChange]);

  React.useEffect(
    () => () => {
      onInteractionBlockedChange?.(false);
      onNavigationBlockedChange?.(false);
    },
    [onInteractionBlockedChange, onNavigationBlockedChange],
  );

  const hasSkills = (skills?.length ?? 0) > 0;

  React.useEffect(() => {
    onCheckUpdatesStateChange?.({
      isChecking: isCheckingUpdates,
      hasSkills,
    });
  }, [hasSkills, isCheckingUpdates, onCheckUpdatesStateChange]);

  React.useEffect(
    () => () =>
      onCheckUpdatesStateChange?.({ isChecking: false, hasSkills: false }),
    [onCheckUpdatesStateChange],
  );

  const beginWrite = (allowOpenDialog = false) => {
    if (
      checkUpdatesLockRef.current ||
      isCheckingUpdates ||
      writeLockRef.current ||
      mutationPending ||
      (!allowOpenDialog && dialogOpen)
    ) {
      return false;
    }
    writeLockRef.current = true;
    setWritePending(true);
    return true;
  };

  const endWrite = () => {
    writeLockRef.current = false;
    setWritePending(false);
  };

  // 「全部更新」只处理确定可更新的条目：远端已删除/无法检查的条目
  // 点更新只会失败，必须排除在批量路径之外。
  const applicableSkillUpdates = useMemo(() => {
    const installedIds = new Set((skills ?? []).map((skill) => skill.id));
    return (skillUpdates ?? []).filter(
      (update) =>
        installedIds.has(update.id) && (update.status ?? "update") === "update",
    );
  }, [skillUpdates, skills]);

  const updatesMap = useMemo(() => {
    const map: Record<string, SkillUpdateInfo> = {};
    const installedIds = new Set((skills ?? []).map((skill) => skill.id));
    for (const update of skillUpdates ?? []) {
      if (installedIds.has(update.id)) {
        map[update.id] = update;
      }
    }
    return map;
  }, [skillUpdates, skills]);

  const enabledCounts = useMemo(() => {
    const counts = {
      claude: 0,
      "claude-desktop": 0,
      codex: 0,
      gemini: 0,
      grokbuild: 0,
      opencode: 0,
      openclaw: 0,
      hermes: 0,
      pi: 0,
      mcode: 0,
    };
    if (!skills) return counts;
    skills.forEach((skill) => {
      for (const app of SKILLS_APP_IDS) {
        if (skill.apps[app]) {
          counts[app]++;
        }
      }
    });
    return counts;
  }, [skills]);

  const filteredSkills = useMemo(() => {
    if (!skills) return [];

    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return skills;

    return skills.filter((skill) => {
      const searchableValues = [
        skill.name,
        skill.id,
        skill.description,
        skill.directory,
        skill.repoOwner,
        skill.repoName,
        skill.repoOwner && skill.repoName
          ? `${skill.repoOwner}/${skill.repoName}`
          : undefined,
      ];

      return searchableValues.some((value) =>
        value?.toLocaleLowerCase().includes(query),
      );
    });
  }, [searchQuery, skills]);

  const pendingApp = bulkToggleAppMutation.isPending
    ? bulkToggleAppMutation.variables?.app
    : toggleAppMutation.isPending
      ? toggleAppMutation.variables?.app
      : null;

  const handleToggleApp = async (id: string, app: AppId, enabled: boolean) => {
    if (!beginWrite()) return;

    try {
      await toggleAppMutation.mutateAsync({ id, app, enabled });
    } catch (error) {
      toast.error(t("common.error"), { description: String(error) });
    } finally {
      endWrite();
    }
  };

  const handleToggleAll = async (app: AppId, enabled: boolean) => {
    if (!skills || !beginWrite()) return;

    const ids = skills
      .filter((skill) => Boolean(skill.apps[app]) !== enabled)
      .map((skill) => skill.id);
    if (ids.length === 0) {
      endWrite();
      return;
    }

    try {
      const result = await bulkToggleAppMutation.mutateAsync({
        ids,
        app,
        enabled,
      });
      if (result.failed.length > 0) {
        toast.error(
          t("common.bulkToggleFailed", { count: result.failed.length }),
          { description: String(result.failed[0].error) },
        );
      }
    } catch (error) {
      toast.error(t("common.bulkToggleFailed", { count: ids.length }), {
        description: String(error),
      });
    } finally {
      endWrite();
    }
  };

  const handleDeployToProject = async (
    skill: InstalledSkill,
    projectRoot: string,
  ) => {
    try {
      const { outcome } = await deployProjectMutation.mutateAsync({
        skillId: skill.id,
        projectRoot,
      });
      setDeployDialogSkill((prev) =>
        prev && prev.id === skill.id
          ? {
              ...prev,
              deployments: [
                ...(prev.deployments ?? []).filter(
                  (d) => d.projectRoot !== projectRoot,
                ),
                { projectRoot, deployedAt: Date.now() },
              ],
            }
          : prev,
      );
      if (outcome === "created") {
        toast.success(
          t("skills.deployToastCreated", {
            name: skill.name,
            path: projectRoot,
          }),
        );
      } else {
        toast.info(t("skills.deployToastAlready", { path: projectRoot }));
      }
    } catch (e) {
      toast.error(extractErrorMessage(e));
    }
  };

  const handleUndeployFromProject = async (
    skill: InstalledSkill,
    projectRoot: string,
  ) => {
    try {
      await undeployProjectMutation.mutateAsync({
        skillId: skill.id,
        projectRoot,
      });
      setDeployDialogSkill((prev) =>
        prev && prev.id === skill.id
          ? {
              ...prev,
              deployments: (prev.deployments ?? []).filter(
                (d) => d.projectRoot !== projectRoot,
              ),
            }
          : prev,
      );
      toast.success(t("skills.deployRemovedToast", { path: projectRoot }));
    } catch (e) {
      toast.error(extractErrorMessage(e));
    }
  };

  // 批量部署（C2 汇总反馈）：allSettled 逐个跑，失败不阻塞成功方；
  // 转专属（B2）：仅对部署成功的 skill 关闭其全部已启用的全局开关，
  // 失败方的全局状态保持原样。
  const handleBatchDeploy = async (
    projectRoot: string,
    selectedSkills: InstalledSkill[],
    disableGlobal: boolean,
  ) => {
    const results = await Promise.allSettled(
      selectedSkills.map((s) =>
        deployProjectMutation.mutateAsync({
          skillId: s.id,
          projectRoot,
        }),
      ),
    );

    const succeeded: InstalledSkill[] = [];
    const failedNames: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") succeeded.push(selectedSkills[i]);
      else failedNames.push(selectedSkills[i].name);
    });

    if (disableGlobal && succeeded.length > 0) {
      await Promise.allSettled(
        succeeded.flatMap((s) =>
          (Object.entries(s.apps) as Array<[AppId, boolean]>)
            .filter(([, enabled]) => enabled)
            .map(([app]) =>
              toggleAppMutation.mutateAsync({
                id: s.id,
                app,
                enabled: false,
              }),
            ),
        ),
      );
    }

    if (succeeded.length > 0) {
      toast.success(
        t("skills.batchDeployToast", {
          count: succeeded.length,
          path: projectRoot,
        }),
      );
    }
    if (failedNames.length > 0) {
      toast.warning(
        t("skills.batchDeployToastFailed", { names: failedNames.join("、") }),
        { closeButton: true },
      );
    }
    setBatchDeployOpen(false);
  };

  const knownProjectRoots = useMemo(() => {
    const roots = new Set<string>();
    for (const s of skills ?? []) {
      for (const d of s.deployments ?? []) roots.add(d.projectRoot);
    }
    return Array.from(roots);
  }, [skills]);

  const handleUninstall = (skill: InstalledSkill) => {
    if (
      checkUpdatesLockRef.current ||
      writeLockRef.current ||
      interactionBlocked
    ) {
      return;
    }
    setConfirmDialog({
      isOpen: true,
      title: t("skills.uninstall"),
      message: t("skills.uninstallConfirm", { name: skill.name }),
      onConfirm: async () => {
        if (!beginWrite(true)) return;
        try {
          const result = await uninstallMutation.mutateAsync(skill.id);
          setConfirmDialog(null);
          const piCleanupIncomplete =
            result.piCleanupIncomplete || Boolean(result.preservedPiPath);
          const toastOptions = {
            description: result.preservedPiPath
              ? t("skills.uninstallPiPreserved", {
                  path: result.preservedPiPath,
                })
              : result.piCleanupIncomplete
                ? t("skills.uninstallPiCleanupIncomplete")
                : result.backupPath
                  ? t("skills.backup.location", { path: result.backupPath })
                  : undefined,
            closeButton: true,
          };
          if (piCleanupIncomplete) {
            toast.warning(
              t("skills.uninstallSuccess", { name: skill.name }),
              toastOptions,
            );
          } else {
            toast.success(
              t("skills.uninstallSuccess", { name: skill.name }),
              toastOptions,
            );
          }
        } catch (error) {
          toast.error(t("common.error"), { description: String(error) });
        } finally {
          endWrite();
        }
      },
    });
  };

  const handleOpenImport = async () => {
    if (!beginWrite()) return;
    try {
      const result = await scanUnmanaged();
      if (!result.data || result.data.length === 0) {
        toast.success(t("skills.noUnmanagedFound"), { closeButton: true });
        return;
      }
      setImportDialogOpen(true);
    } catch (error) {
      toast.error(t("common.error"), { description: String(error) });
    } finally {
      endWrite();
    }
  };

  const handleImport = async (imports: ImportSkillSelection[]) => {
    if (!beginWrite(true)) return;
    try {
      const imported = await importMutation.mutateAsync(imports);
      setImportDialogOpen(false);
      toast.success(t("skills.importSuccess", { count: imported.length }), {
        closeButton: true,
      });
    } catch (error) {
      toast.error(t("common.error"), { description: String(error) });
    } finally {
      endWrite();
    }
  };

  const handleInstallFromZip = async () => {
    if (!beginWrite()) return;
    try {
      const filePath = await skillsApi.openZipFileDialog();
      if (!filePath) return;

      const installed = await installFromZipMutation.mutateAsync({
        filePath,
        currentApp,
      });

      if (installed.length === 0) {
        toast.info(t("skills.installFromZip.noSkillsFound"), {
          closeButton: true,
        });
      } else if (installed.length === 1) {
        toast.success(
          t("skills.installFromZip.successSingle", {
            name: installed[0].name,
          }),
          { closeButton: true },
        );
      } else {
        toast.success(
          t("skills.installFromZip.successMultiple", {
            count: installed.length,
          }),
          { closeButton: true },
        );
      }
    } catch (error) {
      toast.error(t("skills.installFailed"), { description: String(error) });
    } finally {
      endWrite();
    }
  };

  const handleCheckUpdates = async () => {
    if (
      checkUpdatesLockRef.current ||
      writeLockRef.current ||
      interactionBlocked
    ) {
      return;
    }
    checkUpdatesLockRef.current = true;
    try {
      const result = await checkUpdates();
      const updates = result.data || [];
      if (updates.length === 0) {
        toast.success(t("skills.noUpdates"), { closeButton: true });
      } else {
        // 分类汇总：更新数进主文案；已删除/无法检查进 description，
        // 多仓库来源时用户能一眼看出哪些 skill 出了什么状况。
        const deletedCount = updates.filter(
          (u) => u.status === "repo_deleted" || u.status === "skill_deleted",
        ).length;
        const unreachableCount = updates.filter(
          (u) => u.status === "unreachable",
        ).length;
        const updateCount = updates.filter(
          (u) => (u.status ?? "update") === "update",
        ).length;
        const summaryParts: string[] = [];
        if (deletedCount > 0) {
          summaryParts.push(
            t("skills.updatesSummaryDeleted", { count: deletedCount }),
          );
        }
        if (unreachableCount > 0) {
          summaryParts.push(
            t("skills.updatesSummaryUnreachable", { count: unreachableCount }),
          );
        }
        // 全部条目都不是可更新时，「发现 0 个可用更新」读起来突兀，
        // 改用「均为最新」作主文案，状况留在 description。
        const headline =
          updateCount > 0
            ? t("skills.updatesFound", { count: updateCount })
            : t("skills.noUpdates");
        toast.info(headline, {
          description:
            summaryParts.length > 0 ? summaryParts.join(" · ") : undefined,
          closeButton: true,
        });
      }
    } catch (error) {
      toast.error(t("common.error"), { description: String(error) });
    } finally {
      checkUpdatesLockRef.current = false;
    }
  };

  const handleUpdateSkill = async (skill: InstalledSkill) => {
    if (!beginWrite()) return;
    try {
      const updated = await updateSkillMutation.mutateAsync(skill.id);
      toast.success(t("skills.updateSuccess", { name: updated.name }), {
        closeButton: true,
      });
    } catch (error) {
      toast.error(t("skills.updateFailed"), { description: String(error) });
    } finally {
      endWrite();
    }
  };

  const handleUpdateAll = async () => {
    if (applicableSkillUpdates.length === 0 || !beginWrite()) {
      return;
    }
    setIsUpdatingAll(true);
    let successCount = 0;
    try {
      for (const update of applicableSkillUpdates) {
        try {
          await updateSkillMutation.mutateAsync(update.id);
          successCount++;
        } catch (error) {
          toast.error(t("skills.updateFailed"), {
            description: `${update.name}: ${String(error)}`,
          });
        }
      }
    } finally {
      setIsUpdatingAll(false);
      endWrite();
    }
    if (successCount > 0) {
      toast.success(t("skills.updateAllSuccess", { count: successCount }), {
        closeButton: true,
      });
    }
  };

  const handleOpenRestoreFromBackup = async () => {
    if (!beginWrite()) return;
    setRestoreDialogOpen(true);
    try {
      await refetchSkillBackups({ throwOnError: true });
    } catch (error) {
      setRestoreDialogOpen(false);
      toast.error(t("common.error"), { description: String(error) });
    } finally {
      endWrite();
    }
  };

  const handleRestoreFromBackup = async (backupId: string) => {
    if (!beginWrite(true)) return;
    try {
      const restored = await restoreBackupMutation.mutateAsync({
        backupId,
        currentApp,
      });
      setRestoreDialogOpen(false);
      toast.success(
        t("skills.restoreFromBackup.success", { name: restored.name }),
        {
          closeButton: true,
        },
      );
    } catch (error) {
      toast.error(t("skills.restoreFromBackup.failed"), {
        description: String(error),
      });
    } finally {
      endWrite();
    }
  };

  const handleDeleteBackup = (backup: SkillBackupEntry) => {
    if (checkUpdatesLockRef.current || writeLockRef.current) return;
    setConfirmDialog({
      isOpen: true,
      title: t("skills.restoreFromBackup.deleteConfirmTitle"),
      message: t("skills.restoreFromBackup.deleteConfirmMessage", {
        name: backup.skill.name,
      }),
      confirmText: t("skills.restoreFromBackup.delete"),
      variant: "destructive",
      onConfirm: async () => {
        if (!beginWrite(true)) return;
        try {
          let deleteSucceeded = false;
          let deleteError: unknown;
          try {
            await deleteBackupMutation.mutateAsync(backup.backupId);
            deleteSucceeded = true;
          } catch (error) {
            deleteError = error;
          }

          // The backups query is disabled by default, so invalidation alone
          // does not fetch authoritative data. Explicitly refresh after both
          // success and failure (remove_dir_all may have made partial progress).
          let refreshedBackups: SkillBackupEntry[] | undefined;
          try {
            const result = await refetchSkillBackups({ throwOnError: true });
            refreshedBackups = result.data;
          } catch (error) {
            // A refresh failure must not turn a completed deletion into a false
            // "delete failed" report, or replace the original deletion error.
            console.error(
              "Failed to refresh Skill backups after deletion:",
              error,
            );
          }

          if (!deleteSucceeded) {
            // remove_dir_all may finish removing the directory but still
            // report an error. If the authoritative refresh confirms that the
            // item is gone, close the now-stale confirmation dialog.
            if (
              refreshedBackups &&
              !refreshedBackups.some(
                (entry) => entry.backupId === backup.backupId,
              )
            ) {
              setConfirmDialog(null);
            }
            toast.error(t("skills.restoreFromBackup.deleteFailed"), {
              description: String(deleteError),
            });
          } else {
            setConfirmDialog(null);
            toast.success(
              t("skills.restoreFromBackup.deleteSuccess", {
                name: backup.skill.name,
              }),
              {
                closeButton: true,
              },
            );
          }
        } finally {
          endWrite();
        }
      },
    });
  };

  React.useImperativeHandle(ref, () => ({
    openDiscovery: () => {
      if (
        !checkUpdatesLockRef.current &&
        !writeLockRef.current &&
        !interactionBlocked
      ) {
        onOpenDiscovery();
      }
    },
    openImport: handleOpenImport,
    openInstallFromZip: handleInstallFromZip,
    openRestoreFromBackup: handleOpenRestoreFromBackup,
    checkUpdates: handleCheckUpdates,
  }));

  return (
    <div className="px-6 flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <AppCountBar
            totalLabel={t("skills.installed", { count: skills?.length || 0 })}
            counts={enabledCounts}
            appIds={visibleSkillAppIds}
            totalCount={skills?.length ?? 0}
            onToggleAll={handleToggleAll}
            pendingApp={pendingApp}
            disabled={interactionBlocked}
          />
        </div>
        {hasSkills && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mb-4 h-7 shrink-0 text-xs gap-1"
            onClick={() => setBatchDeployOpen(true)}
            disabled={interactionBlocked}
            title={t("skills.batchDeployToProject")}
          >
            <FolderUp size={12} />
            {t("skills.batchDeployToProject")}
          </Button>
        )}
        <div
          className="mb-4 overflow-hidden transition-all duration-300 ease-out"
          style={{
            maxWidth: applicableSkillUpdates.length > 0 ? "200px" : "0px",
            opacity: applicableSkillUpdates.length > 0 ? 1 : 0,
          }}
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1 whitespace-nowrap disabled:opacity-100"
            onClick={handleUpdateAll}
            disabled={interactionBlocked}
          >
            {isUpdatingAll ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            {isUpdatingAll
              ? t("skills.updatingAll")
              : t("skills.updateAll", {
                  count: applicableSkillUpdates.length,
                })}
          </Button>
        </div>
      </div>

      <ManagementListSearch
        value={searchQuery}
        onValueChange={setSearchQuery}
        placeholder={t("skills.installedSearchPlaceholder")}
        ariaLabel={t("skills.installedSearchAriaLabel")}
        clearLabel={t("common.clear")}
      />

      <ScrollArea className="-mr-3 flex-1 min-h-0" type="auto">
        <div className="pb-24 pr-3">
          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground">
              {t("skills.loading")}
            </div>
          ) : !skills || skills.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 bg-muted rounded-full flex items-center justify-center">
                <Sparkles size={24} className="text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">
                {t("skills.noInstalled")}
              </h3>
              <p className="text-muted-foreground text-sm">
                {t("skills.noInstalledDescription")}
              </p>
            </div>
          ) : filteredSkills.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <Search className="mb-4 h-10 w-10 opacity-40" />
              <p className="text-sm">{t("skills.noInstalledSearchResults")}</p>
            </div>
          ) : (
            <TooltipProvider delayDuration={300}>
              <div className="rounded-xl border border-border-default overflow-hidden">
                {filteredSkills.map((skill, index) => (
                  <InstalledSkillListItem
                    key={skill.id}
                    skill={skill}
                    updateStatus={
                      updatesMap[skill.id]
                        ? (updatesMap[skill.id].status ?? "update")
                        : undefined
                    }
                    isUpdating={
                      updateSkillMutation.isPending &&
                      updateSkillMutation.variables === skill.id
                    }
                    actionsDisabled={interactionBlocked}
                    appIds={visibleSkillAppIds}
                    onToggleApp={handleToggleApp}
                    onUninstall={() => handleUninstall(skill)}
                    onUpdate={() => handleUpdateSkill(skill)}
                    onDeployProject={() => setDeployDialogSkill(skill)}
                    isLast={index === filteredSkills.length - 1}
                  />
                ))}
              </div>
            </TooltipProvider>
          )}
        </div>
      </ScrollArea>

      {confirmDialog && (
        <ConfirmDialog
          isOpen={confirmDialog.isOpen}
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmText={confirmDialog.confirmText}
          variant={confirmDialog.variant}
          zIndex="top"
          pending={writePending}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {batchDeployOpen && (
        <BatchDeployDialog
          skills={skills ?? []}
          knownProjects={knownProjectRoots}
          isDeploying={deployProjectMutation.isPending}
          onDeploy={handleBatchDeploy}
          onClose={() => setBatchDeployOpen(false)}
        />
      )}

      {deployDialogSkill && (
        <ProjectDeployDialog
          skill={deployDialogSkill}
          knownProjects={knownProjectRoots}
          isDeploying={deployProjectMutation.isPending}
          isUndeploying={undeployProjectMutation.isPending}
          onDeploy={(root) => handleDeployToProject(deployDialogSkill, root)}
          onUndeploy={(root) =>
            handleUndeployFromProject(deployDialogSkill, root)
          }
          onClose={() => setDeployDialogSkill(null)}
        />
      )}

      {importDialogOpen && unmanagedSkills && (
        <ImportSkillsDialog
          skills={unmanagedSkills}
          isImporting={importMutation.isPending}
          onImport={handleImport}
          onClose={() => setImportDialogOpen(false)}
        />
      )}

      <RestoreSkillsDialog
        backups={skillBackups}
        isDeleting={deleteBackupMutation.isPending}
        isLoading={isFetchingSkillBackups}
        onDelete={handleDeleteBackup}
        isRestoring={restoreBackupMutation.isPending}
        onRestore={handleRestoreFromBackup}
        onClose={() => setRestoreDialogOpen(false)}
        open={restoreDialogOpen}
      />
    </div>
  );
});

UnifiedSkillsPanel.displayName = "UnifiedSkillsPanel";

interface InstalledSkillListItemProps {
  skill: InstalledSkill;
  appIds: AppId[];
  /** 更新检测状态：undefined = 无条目；"update" = 可更新；其余见徽章 */
  updateStatus?: SkillUpdateStatus;
  isUpdating?: boolean;
  actionsDisabled?: boolean;
  onToggleApp: (id: string, app: AppId, enabled: boolean) => void;
  onUninstall: () => void;
  onUpdate?: () => void;
  /** 打开「应用到项目」弹窗 */
  onDeployProject?: () => void;
  isLast?: boolean;
}

const InstalledSkillListItem: React.FC<InstalledSkillListItemProps> = ({
  skill,
  appIds,
  updateStatus,
  isUpdating,
  actionsDisabled,
  onToggleApp,
  onUninstall,
  onUpdate,
  onDeployProject,
  isLast,
}) => {
  const { t } = useTranslation();

  // 领域边界（见 CONTEXT.md）：deleted 是确定性信号（红，提示处理），
  // unreachable 是不确定性信号（灰，稍后再查）；两者都不提供更新按钮。
  const statusBadge = (() => {
    switch (updateStatus) {
      case "update":
        return (
          <Badge
            variant="outline"
            className="shrink-0 text-[10px] px-1.5 py-0 h-4 border-amber-500 text-amber-600 dark:text-amber-400"
          >
            {t("skills.updateAvailable")}
          </Badge>
        );
      case "repo_deleted":
      case "skill_deleted": {
        const isRepo = updateStatus === "repo_deleted";
        const labelKey = isRepo
          ? "skills.statusRepoDeleted"
          : "skills.statusSkillDeleted";
        const hintKey = isRepo
          ? "skills.statusRepoDeletedHint"
          : "skills.statusSkillDeletedHint";
        return (
          <Badge
            variant="outline"
            className="shrink-0 text-[10px] px-1.5 py-0 h-4 border-red-500/60 text-red-600 dark:text-red-400"
            title={t(hintKey)}
          >
            {t(labelKey)}
          </Badge>
        );
      }
      case "unreachable":
        return (
          <Badge
            variant="outline"
            className="shrink-0 text-[10px] px-1.5 py-0 h-4 text-muted-foreground"
            title={t("skills.statusUnreachableHint")}
          >
            {t("skills.statusUnreachable")}
          </Badge>
        );
      case undefined:
        return null;
    }
  })();
  const hasUpdate = updateStatus === "update";

  const openDocs = async () => {
    if (!skill.readmeUrl) return;
    try {
      await settingsApi.openExternal(skill.readmeUrl);
    } catch {
      // ignore
    }
  };

  const sourceLabel = useMemo(() => {
    if (skill.repoOwner && skill.repoName) {
      return `${skill.repoOwner}/${skill.repoName}`;
    }
    return t("skills.local");
  }, [skill.repoOwner, skill.repoName, t]);

  return (
    <ListItemRow isLast={isLast}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-sm text-foreground truncate">
            {skill.name}
          </span>
          {skill.readmeUrl && (
            <button
              type="button"
              onClick={openDocs}
              className="text-muted-foreground/60 hover:text-foreground flex-shrink-0"
            >
              <ExternalLink size={12} />
            </button>
          )}
          <span className="text-xs text-muted-foreground/50 flex-shrink-0">
            {sourceLabel}
          </span>
          {(skill.deployments?.length ?? 0) > 0 && (
            <button
              type="button"
              onClick={onDeployProject}
              className="flex-shrink-0"
              title={t("skills.deployedProjects")}
            >
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 h-4 border-blue-500/50 text-blue-600 dark:text-blue-400"
              >
                <FolderGit2 size={9} className="mr-0.5" />
                {skill.deployments!.length}
              </Badge>
            </button>
          )}
          {statusBadge}
        </div>
        {skill.description && (
          <p
            className="text-xs text-muted-foreground truncate"
            title={skill.description}
          >
            {skill.description}
          </p>
        )}
      </div>

      <AppToggleGroup
        apps={skill.apps}
        onToggle={(app, enabled) => onToggleApp(skill.id, app, enabled)}
        appIds={appIds}
        disabled={actionsDisabled}
      />

      <div
        className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
        style={hasUpdate ? { opacity: 1 } : undefined}
      >
        {hasUpdate && onUpdate && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "h-7 w-7 hover:text-blue-500 hover:bg-blue-100 dark:hover:text-blue-400 dark:hover:bg-blue-500/10",
              actionsDisabled && !isUpdating && "disabled:opacity-100",
            )}
            onClick={onUpdate}
            disabled={actionsDisabled || isUpdating}
            title={t("skills.update")}
          >
            {isUpdating ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
          </Button>
        )}
        {onDeployProject && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 hover:text-blue-500 hover:bg-blue-100 dark:hover:text-blue-400 dark:hover:bg-blue-500/10"
            onClick={onDeployProject}
            disabled={actionsDisabled}
            title={t("skills.deployToProject")}
          >
            <FolderUp size={14} />
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 hover:text-red-500 hover:bg-red-100 disabled:opacity-100 dark:hover:text-red-400 dark:hover:bg-red-500/10"
          onClick={onUninstall}
          disabled={actionsDisabled}
          title={t("skills.uninstall")}
        >
          <Trash2 size={14} />
        </Button>
      </div>
    </ListItemRow>
  );
};

// ===== 批量部署弹窗（以项目为中心）=====
// 一次给一个项目配一套 skill 组合：选项目 → 勾选多个 skill → 部署。
// 可选「转专属」：部署成功后关闭所选 skill 的全部全局开关（B2 共识）。

interface BatchDeployDialogProps {
  skills: InstalledSkill[];
  knownProjects: string[];
  isDeploying: boolean;
  onDeploy: (
    projectRoot: string,
    selectedSkills: InstalledSkill[],
    disableGlobal: boolean,
  ) => void;
  onClose: () => void;
}

const BatchDeployDialog: React.FC<BatchDeployDialogProps> = ({
  skills,
  knownProjects,
  isDeploying,
  onDeploy,
  onClose,
}) => {
  const { t } = useTranslation();
  const [selectedRoot, setSelectedRoot] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [disableGlobal, setDisableGlobal] = useState(true);

  const deployedInProject = useMemo(() => {
    const roots = new Set<string>();
    if (!selectedRoot) return roots;
    for (const s of skills) {
      if ((s.deployments ?? []).some((d) => d.projectRoot === selectedRoot)) {
        roots.add(s.id);
      }
    }
    return roots;
  }, [skills, selectedRoot]);

  const selectableIds = useMemo(
    () => skills.filter((s) => !deployedInProject.has(s.id)).map((s) => s.id),
    [skills, deployedInProject],
  );

  const toggleSelect = (id: string, on: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const pickDirectory = async () => {
    try {
      const picked = await settingsApi.pickDirectory();
      if (picked) setSelectedRoot(picked);
    } catch {
      // 用户取消，忽略
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("skills.batchDeployDialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("skills.deployDialogDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* 项目选择 */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={pickDirectory}
            >
              <FolderGit2 size={14} className="mr-1" />
              {t("skills.deployPickDirectory")}
            </Button>
            {selectedRoot && (
              <span className="text-xs text-muted-foreground truncate flex-1">
                {selectedRoot}
              </span>
            )}
          </div>

          {knownProjects.filter((r) => r !== selectedRoot).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {knownProjects
                .filter((r) => r !== selectedRoot)
                .map((root) => (
                  <button
                    key={root}
                    type="button"
                    onClick={() => setSelectedRoot(root)}
                    className={cn(
                      "rounded-md border px-2 py-0.5 text-[11px] transition-colors truncate max-w-[180px]",
                      selectedRoot === root
                        ? "border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400"
                        : "border-border-default text-muted-foreground hover:text-foreground",
                    )}
                    title={root}
                  >
                    {root}
                  </button>
                ))}
            </div>
          )}

          {/* skill 多选列表 */}
          <div className="rounded-md border border-border-default">
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-default bg-muted/40">
              <Checkbox
                checked={
                  selectableIds.length > 0 &&
                  selectableIds.every((id) => selectedIds.has(id))
                    ? true
                    : selectableIds.some((id) => selectedIds.has(id))
                      ? "indeterminate"
                      : false
                }
                disabled={selectableIds.length === 0 || isDeploying}
                aria-label={t("skills.batchDeploySelectAll")}
                onCheckedChange={() => {
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    const allIn =
                      selectableIds.length > 0 &&
                      selectableIds.every((id) => next.has(id));
                    for (const id of selectableIds) {
                      if (allIn) next.delete(id);
                      else next.add(id);
                    }
                    return next;
                  });
                }}
              />
              <span className="text-xs text-muted-foreground">
                {t("skills.batchDeploySelectAll")}
              </span>
            </div>
            <div className="max-h-56 overflow-y-auto divide-y divide-border-default">
              {skills.map((skill) => {
                const alreadyDeployed = deployedInProject.has(skill.id);
                return (
                  <label
                    key={skill.id}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 text-sm",
                      alreadyDeployed ? "opacity-50" : "cursor-pointer",
                    )}
                  >
                    <Checkbox
                      checked={selectedIds.has(skill.id)}
                      disabled={alreadyDeployed || isDeploying}
                      onCheckedChange={(checked) =>
                        toggleSelect(skill.id, checked === true)
                      }
                    />
                    <span className="truncate flex-1">{skill.name}</span>
                    {alreadyDeployed && (
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {t("skills.batchDeployAlreadyDeployed")}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>

          {/* 转专属选项（默认开） */}
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <Checkbox
              checked={disableGlobal}
              disabled={isDeploying}
              onCheckedChange={(checked) => setDisableGlobal(checked === true)}
            />
            {t("skills.batchDeployDisableGlobal")}
          </label>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={onClose}
              disabled={isDeploying}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              className="flex-1"
              disabled={!selectedRoot || selectedIds.size === 0 || isDeploying}
              onClick={() =>
                selectedRoot &&
                onDeploy(
                  selectedRoot,
                  skills.filter((s) => selectedIds.has(s.id)),
                  disableGlobal,
                )
              }
            >
              {isDeploying ? (
                <Loader2 size={14} className="mr-1 animate-spin" />
              ) : (
                <FolderUp size={14} className="mr-1" />
              )}
              {t("skills.deployConfirm")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ===== 项目部署弹窗 =====
// 领域（见 CONTEXT.md）：项目部署 = symlink 指回 SSOT 本体，落在项目
// `.agents/skills/`（pi 与 Codex 共同识别）；与全局部署正交，同名共存时
// pi 会警告重复，故全局启用时给出黄条提醒。

interface ProjectDeployDialogProps {
  skill: InstalledSkill;
  /** 历史部署过的项目路径（全部 skills 去重，用于快速复选） */
  knownProjects: string[];
  isDeploying: boolean;
  isUndeploying: boolean;
  onDeploy: (projectRoot: string) => void;
  onUndeploy: (projectRoot: string) => void;
  onClose: () => void;
}

const ProjectDeployDialog: React.FC<ProjectDeployDialogProps> = ({
  skill,
  knownProjects,
  isDeploying,
  isUndeploying,
  onDeploy,
  onUndeploy,
  onClose,
}) => {
  const { t } = useTranslation();
  const [selectedRoot, setSelectedRoot] = useState<string | null>(null);

  const deployments = skill.deployments ?? [];
  const deployedRoots = new Set(deployments.map((d) => d.projectRoot));
  const candidateProjects = knownProjects.filter(
    (root) => !deployedRoots.has(root),
  );

  const globallyEnabled = Boolean(
    skill.apps.claude ||
      skill.apps.codex ||
      skill.apps.gemini ||
      skill.apps.grokbuild ||
      skill.apps.opencode ||
      skill.apps.openclaw ||
      skill.apps.hermes ||
      skill.apps.pi ||
      skill.apps.mcode,
  );

  const pickDirectory = async () => {
    try {
      const picked = await settingsApi.pickDirectory();
      if (picked) setSelectedRoot(picked);
    } catch {
      // 用户取消或系统对话框失败，忽略
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("skills.deployDialogTitle", { name: skill.name })}
          </DialogTitle>
          <DialogDescription>
            {t("skills.deployDialogDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* 全局启用冲突提醒（正交但同名共存 pi 会警告） */}
          {globallyEnabled && (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
              {t("skills.deployGlobalConflict")}
            </div>
          )}

          {/* 目标路径选择 */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={pickDirectory}
            >
              <FolderGit2 size={14} className="mr-1" />
              {t("skills.deployPickDirectory")}
            </Button>
            {selectedRoot && (
              <span className="text-xs text-muted-foreground truncate flex-1">
                {selectedRoot}
              </span>
            )}
          </div>

          {/* 历史项目快捷选择 */}
          {candidateProjects.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {candidateProjects.map((root) => (
                <button
                  key={root}
                  type="button"
                  onClick={() => setSelectedRoot(root)}
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-[11px] transition-colors truncate max-w-[180px]",
                    selectedRoot === root
                      ? "border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400"
                      : "border-border-default text-muted-foreground hover:text-foreground",
                  )}
                  title={root}
                >
                  {root}
                </button>
              ))}
            </div>
          )}

          {/* 落点预览 */}
          <div className="rounded-md bg-muted px-3 py-2 font-mono text-[11px] text-muted-foreground break-all">
            {(selectedRoot ?? t("skills.deployTargetPlaceholder")) +
              "/.agents/skills/" +
              skill.directory}
          </div>

          {/* 已部署列表 */}
          {deployments.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-foreground">
                {t("skills.deployedProjects")}
              </p>
              {deployments.map((d) => (
                <div
                  key={d.projectRoot}
                  className="flex items-center justify-between gap-2 rounded-md border border-border-default px-2 py-1"
                >
                  <span
                    className="text-[11px] text-muted-foreground truncate font-mono"
                    title={d.projectRoot}
                  >
                    {d.projectRoot}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 hover:text-red-500"
                    disabled={isUndeploying}
                    onClick={() => onUndeploy(d.projectRoot)}
                    title={t("skills.deployRemove")}
                  >
                    <X size={12} />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={onClose}
              disabled={isDeploying}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              className="flex-1"
              disabled={!selectedRoot || isDeploying}
              onClick={() => selectedRoot && onDeploy(selectedRoot)}
            >
              {isDeploying ? (
                <Loader2 size={14} className="mr-1 animate-spin" />
              ) : (
                <FolderUp size={14} className="mr-1" />
              )}
              {t("skills.deployConfirm")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

interface ImportSkillsDialogProps {
  skills: Array<{
    directory: string;
    name: string;
    description?: string;
    foundIn: string[];
    path: string;
  }>;
  isImporting: boolean;
  onImport: (imports: ImportSkillSelection[]) => void;
  onClose: () => void;
}

interface RestoreSkillsDialogProps {
  backups: SkillBackupEntry[];
  isDeleting: boolean;
  isLoading: boolean;
  isRestoring: boolean;
  onDelete: (backup: SkillBackupEntry) => void;
  onRestore: (backupId: string) => void;
  onClose: () => void;
  open: boolean;
}

const RestoreSkillsDialog: React.FC<RestoreSkillsDialogProps> = ({
  backups,
  isDeleting,
  isLoading,
  isRestoring,
  onDelete,
  onRestore,
  onClose,
  open,
}) => {
  const { t } = useTranslation();
  const actionPending = isRestoring || isDeleting;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && !actionPending && onClose()}
    >
      <DialogContent
        className="max-w-2xl max-h-[85vh] flex flex-col"
        zIndex="alert"
      >
        <DialogHeader>
          <DialogTitle>{t("skills.restoreFromBackup.title")}</DialogTitle>
          <DialogDescription>
            {t("skills.restoreFromBackup.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : backups.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t("skills.restoreFromBackup.empty")}
            </div>
          ) : (
            <div className="space-y-3">
              {backups.map((backup) => (
                <div
                  key={backup.backupId}
                  className="rounded-xl border border-border-default bg-background/70 p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="font-medium text-sm text-foreground">
                          {backup.skill.name}
                        </div>
                        <div className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          {backup.skill.directory}
                        </div>
                      </div>
                      {backup.skill.description && (
                        <div className="mt-2 text-sm text-muted-foreground">
                          {backup.skill.description}
                        </div>
                      )}
                      <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                        <div>
                          {t("skills.restoreFromBackup.createdAt")}:{" "}
                          {formatSkillBackupDate(backup.createdAt)}
                        </div>
                        <div className="break-all" title={backup.backupPath}>
                          {t("skills.restoreFromBackup.path")}:{" "}
                          {backup.backupPath}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 sm:min-w-28">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => onRestore(backup.backupId)}
                        disabled={isRestoring || isDeleting}
                      >
                        {isRestoring
                          ? t("skills.restoreFromBackup.restoring")
                          : t("skills.restoreFromBackup.restore")}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => onDelete(backup)}
                        disabled={isRestoring || isDeleting}
                      >
                        {isDeleting
                          ? t("skills.restoreFromBackup.deleting")
                          : t("skills.restoreFromBackup.delete")}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={actionPending}
          >
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const ImportSkillsDialog: React.FC<ImportSkillsDialogProps> = ({
  skills,
  isImporting,
  onImport,
  onClose,
}) => {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(
    new Set(skills.map((s) => s.directory)),
  );
  const [selectedApps, setSelectedApps] = useState<
    Record<string, ImportSkillSelection["apps"]>
  >(() =>
    Object.fromEntries(
      skills.map((skill) => [
        skill.directory,
        {
          claude: skill.foundIn.includes("claude"),
          codex: skill.foundIn.includes("codex"),
          gemini: skill.foundIn.includes("gemini"),
          grokbuild: skill.foundIn.includes("grokbuild"),
          opencode: skill.foundIn.includes("opencode"),
          openclaw: false,
          hermes: skill.foundIn.includes("hermes"),
          pi: false,
          mcode: skill.foundIn.includes("mcode"),
        },
      ]),
    ),
  );

  const toggleSelect = (directory: string) => {
    const newSelected = new Set(selected);
    if (newSelected.has(directory)) {
      newSelected.delete(directory);
    } else {
      newSelected.add(directory);
    }
    setSelected(newSelected);
  };

  const handleImport = () => {
    onImport(
      Array.from(selected).map((directory) => ({
        directory,
        apps: selectedApps[directory] ?? {
          claude: false,
          codex: false,
          gemini: false,
          grokbuild: false,
          opencode: false,
          openclaw: false,
          hermes: false,
          pi: false,
          mcode: false,
        },
      })),
    );
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-background rounded-xl p-6 max-w-lg w-full mx-4 shadow-xl max-h-[80vh] flex flex-col">
          <h2 className="text-lg font-semibold mb-2">{t("skills.import")}</h2>
          <p className="text-sm text-muted-foreground mb-4">
            {t("skills.importDescription")}
          </p>

          <div className="flex-1 overflow-y-auto space-y-2 mb-4">
            {skills.map((skill) => (
              <div
                key={skill.directory}
                className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={selected.has(skill.directory)}
                  onChange={() => toggleSelect(skill.directory)}
                  aria-label={skill.name}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{skill.name}</div>
                  {skill.description && (
                    <div className="text-sm text-muted-foreground line-clamp-1">
                      {skill.description}
                    </div>
                  )}
                  <div className="mt-2">
                    <AppToggleGroup
                      apps={
                        selectedApps[skill.directory] ?? {
                          claude: false,
                          codex: false,
                          gemini: false,
                          grokbuild: false,
                          opencode: false,
                          openclaw: false,
                          hermes: false,
                        }
                      }
                      onToggle={(app, enabled) => {
                        setSelectedApps((prev) => ({
                          ...prev,
                          [skill.directory]: {
                            ...(prev[skill.directory] ?? {
                              claude: false,
                              codex: false,
                              gemini: false,
                              grokbuild: false,
                              opencode: false,
                              openclaw: false,
                              hermes: false,
                            }),
                            [app]: enabled,
                          },
                        }));
                      }}
                      appIds={IMPORT_SKILLS_APP_IDS}
                    />
                  </div>
                  <div
                    className="text-xs text-muted-foreground/50 mt-1 truncate"
                    title={skill.path}
                  >
                    {skill.path}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={onClose} disabled={isImporting}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleImport}
              disabled={selected.size === 0 || isImporting}
            >
              {t("skills.importSelected", { count: selected.size })}
            </Button>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
};

export default UnifiedSkillsPanel;
