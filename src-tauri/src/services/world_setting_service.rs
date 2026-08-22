use crate::domain::world::{
    ProtagonistDto, RuleSystemDto, SaveProtagonistInput, SaveRuleSystemInput,
    SaveWorldSettingInput, WorldSettingDto,
};
use crate::repositories::world_setting_repository;
use rusqlite::Connection;

// ==================== World Setting ====================

pub fn list_world_settings_by_novel(
    conn: &Connection,
    novel_id: &str,
) -> Result<Vec<WorldSettingDto>, String> {
    world_setting_repository::find_world_settings_by_novel(conn, novel_id)
}

#[allow(dead_code)]
pub fn get_world_setting(conn: &Connection, id: &str) -> Result<Option<WorldSettingDto>, String> {
    world_setting_repository::find_world_setting_by_id(conn, id)
}

pub fn save_world_setting(
    conn: &Connection,
    id: Option<String>,
    input: SaveWorldSettingInput,
) -> Result<WorldSettingDto, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let target_id = match id {
        Some(existing_id) => {
            world_setting_repository::update_world_setting(
                conn,
                &existing_id,
                &input.title,
                &input.content,
                input.is_active,
                &now,
            )?;
            existing_id
        }
        None => {
            let new_id = uuid::Uuid::new_v4().to_string();
            world_setting_repository::insert_world_setting(
                conn,
                &new_id,
                &input.novel_id,
                &input.title,
                &input.content,
                input.is_active,
                &now,
            )?;
            new_id
        }
    };

    world_setting_repository::find_world_setting_by_id(conn, &target_id)?
        .ok_or_else(|| "无法读取保存后的世界观设定".to_string())
}

// ==================== Rule System ====================

pub fn list_rule_systems_by_novel(
    conn: &Connection,
    novel_id: &str,
) -> Result<Vec<RuleSystemDto>, String> {
    world_setting_repository::find_rule_systems_by_novel(conn, novel_id)
}

#[allow(dead_code)]
pub fn get_rule_system(conn: &Connection, id: &str) -> Result<Option<RuleSystemDto>, String> {
    world_setting_repository::find_rule_system_by_id(conn, id)
}

pub fn save_rule_system(
    conn: &Connection,
    id: Option<String>,
    input: SaveRuleSystemInput,
) -> Result<RuleSystemDto, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let target_id = match id {
        Some(existing_id) => {
            world_setting_repository::update_rule_system(
                conn,
                &existing_id,
                &input.title,
                input.category.as_deref(),
                &input.content,
                input.forbidden_rules.as_deref(),
                input.is_active,
                &now,
            )?;
            existing_id
        }
        None => {
            let new_id = uuid::Uuid::new_v4().to_string();
            world_setting_repository::insert_rule_system(
                conn,
                &new_id,
                &input.novel_id,
                &input.title,
                input.category.as_deref(),
                &input.content,
                input.forbidden_rules.as_deref(),
                input.is_active,
                &now,
            )?;
            new_id
        }
    };

    world_setting_repository::find_rule_system_by_id(conn, &target_id)?
        .ok_or_else(|| "无法读取保存后的规则系统".to_string())
}

pub fn delete_rule_system(conn: &Connection, id: &str) -> Result<(), String> {
    world_setting_repository::delete_rule_system(conn, id)
}

// ==================== Protagonist ====================

pub fn get_protagonist_by_novel(
    conn: &Connection,
    novel_id: &str,
) -> Result<Option<ProtagonistDto>, String> {
    world_setting_repository::find_protagonist_by_novel(conn, novel_id)
}

pub fn save_protagonist(
    conn: &Connection,
    id: Option<String>,
    input: SaveProtagonistInput,
) -> Result<ProtagonistDto, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let target_id = match id {
        Some(existing_id) => {
            world_setting_repository::update_protagonist(
                conn,
                &existing_id,
                &input.name,
                input.identity.as_deref(),
                input.personality.as_deref(),
                input.goal.as_deref(),
                input.special_ability.as_deref(),
                input.ability_limits.as_deref(),
                input.forbidden_behaviors.as_deref(),
                input.current_state.as_deref(),
                &now,
            )?;
            existing_id
        }
        None => {
            let new_id = uuid::Uuid::new_v4().to_string();
            world_setting_repository::insert_protagonist(
                conn,
                &new_id,
                &input.novel_id,
                &input.name,
                input.identity.as_deref(),
                input.personality.as_deref(),
                input.goal.as_deref(),
                input.special_ability.as_deref(),
                input.ability_limits.as_deref(),
                input.forbidden_behaviors.as_deref(),
                input.current_state.as_deref(),
                &now,
            )?;
            new_id
        }
    };

    world_setting_repository::find_protagonist_by_id(conn, &target_id)?
        .ok_or_else(|| "无法读取保存后的主角设定".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::create_tables(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO novels (id, title, created_at, updated_at) VALUES ('novel-1', '测试小说', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        ).unwrap();
        conn
    }

    #[test]
    fn test_world_setting_crud() {
        let conn = setup_test_db();
        let setting = save_world_setting(
            &conn,
            None,
            SaveWorldSettingInput {
                novel_id: "novel-1".to_string(),
                title: "灵气复苏背景".to_string(),
                content: "公元2040年，天地异变，灵气爆发。".to_string(),
                is_active: true,
            },
        )
        .unwrap();

        assert_eq!(setting.title, "灵气复苏背景");
        assert!(setting.is_active);

        let list = list_world_settings_by_novel(&conn, "novel-1").unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, setting.id);

        let updated = save_world_setting(
            &conn,
            Some(setting.id.clone()),
            SaveWorldSettingInput {
                novel_id: "novel-1".to_string(),
                title: "灵气复苏新背景".to_string(),
                content: "公元2042年，大灾变之后。".to_string(),
                is_active: false,
            },
        )
        .unwrap();

        assert_eq!(updated.title, "灵气复苏新背景");
        assert!(!updated.is_active);
    }

    #[test]
    fn test_rule_system_crud() {
        let conn = setup_test_db();
        let rule = save_rule_system(
            &conn,
            None,
            SaveRuleSystemInput {
                novel_id: "novel-1".to_string(),
                title: "九品修炼体系".to_string(),
                category: Some("power".to_string()),
                content: "一品练气，二品筑基，三品金丹。".to_string(),
                forbidden_rules: Some("不得越级击杀".to_string()),
                is_active: true,
            },
        )
        .unwrap();

        assert_eq!(rule.title, "九品修炼体系");
        assert_eq!(rule.category.as_deref(), Some("power"));

        let list = list_rule_systems_by_novel(&conn, "novel-1").unwrap();
        assert_eq!(list.len(), 1);

        delete_rule_system(&conn, &rule.id).unwrap();
        let list_after = list_rule_systems_by_novel(&conn, "novel-1").unwrap();
        assert_eq!(list_after.len(), 0);
    }

    #[test]
    fn test_protagonist_crud() {
        let conn = setup_test_db();
        let protag = save_protagonist(
            &conn,
            None,
            SaveProtagonistInput {
                novel_id: "novel-1".to_string(),
                name: "叶凡".to_string(),
                identity: Some("荒古圣体".to_string()),
                personality: Some("坚毅果敢".to_string()),
                goal: Some("成仙".to_string()),
                special_ability: Some("皆字秘".to_string()),
                ability_limits: Some("触发概率低".to_string()),
                forbidden_behaviors: Some("背叛同伴".to_string()),
                current_state: Some("初始练气期".to_string()),
            },
        )
        .unwrap();

        assert_eq!(protag.name, "叶凡");

        let fetched = get_protagonist_by_novel(&conn, "novel-1").unwrap().unwrap();
        assert_eq!(fetched.name, "叶凡");
        assert_eq!(fetched.identity.as_deref(), Some("荒古圣体"));
    }
}
