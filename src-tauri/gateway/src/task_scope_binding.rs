//! Pure authoritative target binding shared by task capability dispatch.
use super::*;

pub(super) fn bind_search_memory_target(
    scope: Option<&TaskScope>,
    arguments: &Value,
) -> Result<Value, String> {
    let Some(bound_chapter_id) = scope.and_then(|scope| scope.chapter_id.as_deref()) else {
        return Ok(arguments.clone());
    };
    let mut object = arguments
        .as_object()
        .cloned()
        .ok_or_else(|| TASK_CHAPTER_SCOPE_REJECTED.to_string())?;
    for key in ["targetChapterId", "target_chapter_id"] {
        if let Some(explicit_target) = object.get(key) {
            if explicit_target.as_str() != Some(bound_chapter_id) {
                return Err(TASK_CHAPTER_SCOPE_REJECTED.to_string());
            }
        }
    }
    if !object.contains_key("targetChapterId") && !object.contains_key("target_chapter_id") {
        object.insert(
            "targetChapterId".to_string(),
            Value::String(bound_chapter_id.to_string()),
        );
    }
    Ok(Value::Object(object))
}

pub(super) fn bind_novel_candidate_target(
    scope: Option<&TaskScope>,
    arguments: &Value,
) -> Result<Value, String> {
    let Some(scope) = scope else {
        return Ok(arguments.clone());
    };
    if scope.chapter_id.is_some() {
        return Ok(arguments.clone());
    }
    let mut object = arguments
        .as_object()
        .cloned()
        .ok_or_else(|| TASK_NOVEL_SCOPE_REJECTED.to_string())?;
    match object.get("novelId") {
        Some(value) if value.as_str() != Some(scope.novel_id.as_str()) => {
            return Err(TASK_NOVEL_SCOPE_REJECTED.to_string())
        }
        Some(_) => {}
        None => {
            object.insert("novelId".to_string(), Value::String(scope.novel_id.clone()));
        }
    }
    object.remove("chapterId");
    object.remove("chapter_id");
    Ok(Value::Object(object))
}
