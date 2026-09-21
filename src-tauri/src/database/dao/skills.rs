//! Skills 数据访问对象
//!
//! 提供 Skills 和 Skill Repos 的 CRUD 操作。
//!
//! v3.10.0+ 统一管理架构：
//! - Skills 使用统一的 id 主键，支持四应用启用标志
//! - 实际文件存储在 ~/.cc-switch/skills/，同步到各应用目录

use crate::app_config::{InstalledSkill, ProjectDeployment, SkillApps};
use crate::database::{lock_conn, Database};
use crate::error::AppError;
use crate::services::skill::SkillRepo;
use indexmap::IndexMap;
use rusqlite::params;

impl Database {
    // ========== InstalledSkill CRUD ==========

    /// 获取所有已安装的 Skills
    pub fn get_all_installed_skills(&self) -> Result<IndexMap<String, InstalledSkill>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT id, name, description, directory, repo_owner, repo_name, repo_branch,
                        readme_url, enabled_claude, enabled_codex, enabled_gemini, enabled_grokbuild,
                        enabled_opencode, enabled_hermes, installed_at, content_hash, updated_at, enabled_mcode
                 FROM skills ORDER BY name ASC",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;

        let skill_iter = stmt
            .query_map([], |row| {
                Ok(InstalledSkill {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    directory: row.get(3)?,
                    repo_owner: row.get(4)?,
                    repo_name: row.get(5)?,
                    repo_branch: row.get(6)?,
                    readme_url: row.get(7)?,
                    apps: SkillApps {
                        claude: row.get(8)?,
                        codex: row.get(9)?,
                        gemini: row.get(10)?,
                        grokbuild: row.get(11)?,
                        opencode: row.get(12)?,
                        hermes: row.get(13)?,
                        pi: false,
                        mcode: row.get(17)?,
                    },
                    installed_at: row.get(14)?,
                    content_hash: row.get(15)?,
                    updated_at: row.get::<_, i64>(16).unwrap_or(0),
                    deployments: Vec::new(),
                })
            })
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut skills = IndexMap::new();
        for skill_res in skill_iter {
            let skill = skill_res.map_err(|e| AppError::Database(e.to_string()))?;
            skills.insert(skill.id.clone(), skill);
        }
        Ok(skills)
    }

    /// 获取单个已安装的 Skill
    pub fn get_installed_skill(&self, id: &str) -> Result<Option<InstalledSkill>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT id, name, description, directory, repo_owner, repo_name, repo_branch,
                        readme_url, enabled_claude, enabled_codex, enabled_gemini, enabled_grokbuild,
                        enabled_opencode, enabled_hermes, installed_at, content_hash, updated_at, enabled_mcode
                 FROM skills WHERE id = ?1",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;

        let result = stmt.query_row([id], |row| {
            Ok(InstalledSkill {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                directory: row.get(3)?,
                repo_owner: row.get(4)?,
                repo_name: row.get(5)?,
                repo_branch: row.get(6)?,
                readme_url: row.get(7)?,
                apps: SkillApps {
                    claude: row.get(8)?,
                    codex: row.get(9)?,
                    gemini: row.get(10)?,
                    grokbuild: row.get(11)?,
                    opencode: row.get(12)?,
                    hermes: row.get(13)?,
                    pi: false,
                    mcode: row.get(17)?,
                },
                installed_at: row.get(14)?,
                content_hash: row.get(15)?,
                updated_at: row.get::<_, i64>(16).unwrap_or(0),
                deployments: Vec::new(),
            })
        });

        match result {
            Ok(skill) => Ok(Some(skill)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    /// 保存 Skill（添加或更新）
    pub fn save_skill(&self, skill: &InstalledSkill) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "INSERT OR REPLACE INTO skills
             (id, name, description, directory, repo_owner, repo_name, repo_branch,
              readme_url, enabled_claude, enabled_codex, enabled_gemini, enabled_grokbuild, enabled_opencode, enabled_hermes,
              installed_at, content_hash, updated_at, enabled_mcode)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
            params![
                skill.id,
                skill.name,
                skill.description,
                skill.directory,
                skill.repo_owner,
                skill.repo_name,
                skill.repo_branch,
                skill.readme_url,
                skill.apps.claude,
                skill.apps.codex,
                skill.apps.gemini,
                skill.apps.grokbuild,
                skill.apps.opencode,
                skill.apps.hermes,
                skill.installed_at,
                skill.content_hash,
                skill.updated_at,
                skill.apps.mcode,
            ],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    /// 仅更新已安装 Skill 的元数据，不修改各应用的启用状态。
    ///
    /// 与 [`Self::save_skill`] 不同，本方法不会插入缺失记录。更新操作可能在网络
    /// 下载期间与启用状态切换或卸载并发发生，因此调用方必须保留数据库中的
    /// `enabled_*` 字段，并在记录已被删除时停止后续处理。
    pub fn update_skill_metadata(&self, skill: &InstalledSkill) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute(
                "UPDATE skills
                 SET name = ?1,
                     description = ?2,
                     directory = ?3,
                     repo_owner = ?4,
                     repo_name = ?5,
                     repo_branch = ?6,
                     readme_url = ?7,
                     installed_at = ?8,
                     content_hash = ?9,
                     updated_at = ?10
                 WHERE id = ?11 AND installed_at = ?12",
                params![
                    skill.name,
                    skill.description,
                    skill.directory,
                    skill.repo_owner,
                    skill.repo_name,
                    skill.repo_branch,
                    skill.readme_url,
                    skill.installed_at,
                    skill.content_hash,
                    skill.updated_at,
                    skill.id,
                    skill.installed_at,
                ],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(affected > 0)
    }

    /// 删除 Skill
    pub fn delete_skill(&self, id: &str) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute("DELETE FROM skills WHERE id = ?1", params![id])
            .map_err(|e| AppError::Database(e.to_string()))?;
        if affected > 0 {
            // 级联清理项目部署记录，避免悬空行让卸载遍历永远残留
            conn.execute(
                "DELETE FROM skill_project_deployments WHERE skill_id = ?1",
                params![id],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        }
        Ok(affected > 0)
    }

    /// 清空所有 Skills（用于迁移）
    pub fn clear_skills(&self) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute("DELETE FROM skills", [])
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    /// 更新 Skill 的应用启用状态
    pub fn update_skill_apps(&self, id: &str, apps: &SkillApps) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute(
                "UPDATE skills SET enabled_claude = ?1, enabled_codex = ?2, enabled_gemini = ?3, enabled_grokbuild = ?4, enabled_opencode = ?5, enabled_hermes = ?6, enabled_mcode = ?8 WHERE id = ?7",
                params![apps.claude, apps.codex, apps.gemini, apps.grokbuild, apps.opencode, apps.hermes, id, apps.mcode],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(affected > 0)
    }

    // ===== 项目部署记录 =====

    /// 登记一次项目部署；同一 (skill, project) 重复登记幂等（不报错、不重复）。
    pub fn add_project_deployment(
        &self,
        skill_id: &str,
        project_root: &str,
        deployed_at: i64,
    ) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "INSERT OR IGNORE INTO skill_project_deployments (skill_id, project_root, deployed_at)
             VALUES (?1, ?2, ?3)",
            params![skill_id, project_root, deployed_at],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    /// 移除一条项目部署记录；不存在时幂等成功。
    pub fn remove_project_deployment(
        &self,
        skill_id: &str,
        project_root: &str,
    ) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "DELETE FROM skill_project_deployments WHERE skill_id = ?1 AND project_root = ?2",
            params![skill_id, project_root],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    /// 查询某 skill 的全部项目部署。
    pub fn get_skill_deployments(&self, skill_id: &str) -> Result<Vec<ProjectDeployment>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT project_root, deployed_at FROM skill_project_deployments
                 WHERE skill_id = ?1 ORDER BY deployed_at ASC",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        let rows = stmt
            .query_map(params![skill_id], |row| {
                Ok(ProjectDeployment {
                    project_root: row.get(0)?,
                    deployed_at: row.get(1)?,
                })
            })
            .map_err(|e| AppError::Database(e.to_string()))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| AppError::Database(e.to_string()))
    }

    /// 只重写 readme_url（存量坏链接纠偏），不动其他字段。
    /// 返回 false 表示目标行不存在（已被卸载）。
    pub fn update_skill_readme_url(&self, id: &str, readme_url: &str) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute(
                "UPDATE skills SET readme_url = ?1 WHERE id = ?2",
                params![readme_url, id],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(affected > 0)
    }

    /// 更新 Skill 的内容哈希和更新时间
    pub fn update_skill_hash(
        &self,
        id: &str,
        content_hash: &str,
        updated_at: i64,
    ) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute(
                "UPDATE skills SET content_hash = ?1, updated_at = ?2 WHERE id = ?3",
                params![content_hash, updated_at, id],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(affected > 0)
    }

    // ========== SkillRepo CRUD（保持原有） ==========

    /// 获取所有 Skill 仓库
    pub fn get_skill_repos(&self) -> Result<Vec<SkillRepo>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT owner, name, branch, enabled FROM skill_repos ORDER BY owner ASC, name ASC",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;

        let repo_iter = stmt
            .query_map([], |row| {
                Ok(SkillRepo {
                    owner: row.get(0)?,
                    name: row.get(1)?,
                    branch: row.get(2)?,
                    enabled: row.get(3)?,
                })
            })
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut repos = Vec::new();
        for repo_res in repo_iter {
            repos.push(repo_res.map_err(|e| AppError::Database(e.to_string()))?);
        }
        Ok(repos)
    }

    /// 保存 Skill 仓库
    pub fn save_skill_repo(&self, repo: &SkillRepo) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "INSERT OR REPLACE INTO skill_repos (owner, name, branch, enabled) VALUES (?1, ?2, ?3, ?4)",
            params![repo.owner, repo.name, repo.branch, repo.enabled],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    /// 删除 Skill 仓库
    pub fn delete_skill_repo(&self, owner: &str, name: &str) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "DELETE FROM skill_repos WHERE owner = ?1 AND name = ?2",
            params![owner, name],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    /// 初始化默认的 Skill 仓库（启动时调用，每个数据库仅执行一次）
    pub fn init_default_skill_repos(&self) -> Result<usize, AppError> {
        const INITIALIZED_KEY: &str = "default_skill_repos_initialized";

        if self.get_bool_flag(INITIALIZED_KEY)? {
            return Ok(0);
        }

        // 兼容升级前已经存在的用户选择，并记录初始化状态，避免以后删空后恢复默认值。
        if !self.get_skill_repos()?.is_empty() {
            self.set_setting(INITIALIZED_KEY, "true")?;
            return Ok(0);
        }

        let default_store = crate::services::skill::SkillStore::default();
        let mut count = 0;

        for repo in &default_store.repos {
            self.save_skill_repo(repo)?;
            count += 1;
            log::info!("初始化默认 Skill 仓库: {}/{}", repo.owner, repo.name);
        }

        self.set_setting(INITIALIZED_KEY, "true")?;
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_config::AppType;

    fn skill(id: &str, name: &str, apps: SkillApps) -> InstalledSkill {
        InstalledSkill {
            id: id.to_string(),
            name: name.to_string(),
            description: Some(format!("{name} description")),
            directory: format!("{name}-directory"),
            repo_owner: Some("owner".to_string()),
            repo_name: Some("repo".to_string()),
            repo_branch: Some("main".to_string()),
            readme_url: Some(format!("https://example.com/{name}")),
            apps,
            installed_at: 1,
            content_hash: Some(format!("{name}-hash")),
            updated_at: 2,
            deployments: Vec::new(),
        }
    }



    // ===== 项目部署记录 =====

    #[test]
    fn project_deployment_roundtrip_and_idempotent_add() {
        let db = Database::memory().expect("memory db");
        let original = skill("owner/repo:skill", "original", SkillApps::only(&AppType::Pi));
        db.save_skill(&original).expect("seed skill");

        db.add_project_deployment(&original.id, "/tmp/proj-a", 100)
            .expect("add deployment");
        // 同一 (skill, project) 重复登记不报错也不产生重复行
        db.add_project_deployment(&original.id, "/tmp/proj-a", 200)
            .expect("re-add deployment is idempotent");

        let deps = db.get_skill_deployments(&original.id).expect("query");
        assert_eq!(deps.len(), 1);
        assert_eq!(deps[0].project_root, "/tmp/proj-a");

        // 另一个项目共存
        db.add_project_deployment(&original.id, "/tmp/proj-b", 300)
            .expect("add second project");

        let all = db.get_skill_deployments(&original.id).expect("query");
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn remove_project_deployment_and_cascade_on_skill_delete() {
        let db = Database::memory().expect("memory db");
        let original = skill("owner/repo:skill", "original", SkillApps::only(&AppType::Pi));
        db.save_skill(&original).expect("seed skill");
        db.add_project_deployment(&original.id, "/tmp/proj-a", 100)
            .expect("add deployment");

        db.remove_project_deployment(&original.id, "/tmp/proj-a")
            .expect("remove deployment");
        assert!(db.get_skill_deployments(&original.id).expect("query").is_empty());
        // 移除不存在的记录也成功（幂等）
        db.remove_project_deployment(&original.id, "/tmp/proj-a")
            .expect("remove missing deployment is idempotent");

        db.add_project_deployment(&original.id, "/tmp/proj-c", 400)
            .expect("re-add for cascade test");
        db.delete_skill(&original.id).expect("delete skill");
        // skill 行删除后部署记录随之清理（悬空记录会让卸载遍历永远删不掉）
        assert!(db.get_skill_deployments(&original.id).expect("query").is_empty());
    }

    #[test]
    fn update_skill_readme_url_rewrites_only_url_and_missing_returns_false() {
        let db = Database::memory().expect("memory db");
        let original = skill("owner/repo:skill", "original", SkillApps::only(&AppType::Claude));
        db.save_skill(&original).expect("seed skill");

        let fixed = "https://github.com/owner/repo/blob/main/skills/skill/SKILL.md";
        assert!(db
            .update_skill_readme_url(&original.id, fixed)
            .expect("update readme url"));

        let stored = db
            .get_installed_skill(&original.id)
            .expect("query skill")
            .expect("skill remains installed");
        assert_eq!(stored.readme_url.as_deref(), Some(fixed));
        // 只动 URL，其余字段不受影响
        assert_eq!(stored.name, original.name);
        assert_eq!(stored.content_hash, original.content_hash);
        assert_eq!(stored.updated_at, original.updated_at);

        assert!(!db
            .update_skill_readme_url("owner/repo:ghost", fixed)
            .expect("update missing skill"));
    }

    #[test]
    fn update_skill_metadata_preserves_enabled_apps() {
        let db = Database::memory().expect("memory db");
        let installed_apps = SkillApps::only(&AppType::Codex);
        let original = skill("owner/repo:skill", "original", installed_apps.clone());
        db.save_skill(&original).expect("seed skill");

        let mut candidate = skill(&original.id, "updated", SkillApps::only(&AppType::Claude));
        candidate.repo_branch = Some("next".to_string());
        candidate.updated_at = 42;

        assert!(db
            .update_skill_metadata(&candidate)
            .expect("update metadata"));

        let stored = db
            .get_installed_skill(&original.id)
            .expect("query skill")
            .expect("skill remains installed");
        assert_eq!(stored.name, candidate.name);
        assert_eq!(stored.description, candidate.description);
        assert_eq!(stored.directory, candidate.directory);
        assert_eq!(stored.repo_branch, candidate.repo_branch);
        assert_eq!(stored.readme_url, candidate.readme_url);
        assert_eq!(stored.content_hash, candidate.content_hash);
        assert_eq!(stored.updated_at, candidate.updated_at);
        assert_eq!(stored.apps, installed_apps);
    }

    #[test]
    fn update_skill_metadata_does_not_insert_missing_skill() {
        let db = Database::memory().expect("memory db");
        let candidate = skill(
            "owner/repo:missing",
            "missing",
            SkillApps::only(&AppType::Claude),
        );

        assert!(!db
            .update_skill_metadata(&candidate)
            .expect("missing update is not an error"));
        assert!(db
            .get_installed_skill(&candidate.id)
            .expect("query skill")
            .is_none());
    }

    #[test]
    fn update_skill_metadata_does_not_touch_reinstalled_generation() {
        let db = Database::memory().expect("memory db");
        let stale_update = skill(
            "owner/repo:skill",
            "stale-update",
            SkillApps::only(&AppType::Claude),
        );

        let mut reinstalled = skill(
            &stale_update.id,
            "reinstalled",
            SkillApps::only(&AppType::Gemini),
        );
        reinstalled.installed_at = stale_update.installed_at + 1;
        db.save_skill(&reinstalled).expect("seed reinstalled skill");

        assert!(!db
            .update_skill_metadata(&stale_update)
            .expect("stale generation update is not an error"));

        let stored = db
            .get_installed_skill(&reinstalled.id)
            .expect("query skill")
            .expect("reinstalled generation remains");
        assert_eq!(stored.name, reinstalled.name);
        assert_eq!(stored.installed_at, reinstalled.installed_at);
        assert_eq!(stored.apps, reinstalled.apps);
    }
}
