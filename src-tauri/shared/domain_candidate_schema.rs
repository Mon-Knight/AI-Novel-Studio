//! Shared, bounded structural contracts for candidate-only domain stages.
use serde_json::{json, Map, Value};
#[path="domain_candidate_style_schema.rs"]
mod style_schema;
#[path = "domain_candidate_mock.rs"]
mod mock;
pub use mock::mock_payload;

fn text() -> Value {
    json!({"type":"string","minLength":1,"maxLength":10_000})
}
fn number(min: i64, max: i64) -> Value {
    json!({"type":"integer","minimum":min,"maximum":max})
}
fn list(item: Value, min: usize, max: usize) -> Value {
    json!({"type":"array","items":item,"minItems":min,"maxItems":max})
}
fn strings() -> Value {
    list(text(), 0, 100)
}
fn object(fields: &[(&str, Value)]) -> Value {
    let properties: Map<String, Value> = fields
        .iter()
        .map(|(name, value)| (name.to_string(), value.clone()))
        .collect();
    json!({"type":"object","required":fields.iter().map(|(name,_)|*name).collect::<Vec<_>>(),"additionalProperties":false,"properties":properties})
}
fn optional(mut schema:Value,fields:&[(&str,Value)])->Value {
    for(key,value)in fields{schema["properties"][*key]=value.clone();}schema
}
fn entity(fields: &[(&str, Value)]) -> Value {
    let mut all = vec![("id", text())];
    all.extend_from_slice(fields);
    object(&all)
}
fn choice(values: &[&str]) -> Value {
    json!({"enum":values})
}

pub fn schema(kind: &str, stage: &str) -> Result<Value, String> {
    if kind=="style_analyze" {
        if stage.trim().is_empty()||stage.len()>160{return Err("STYLE_STAGE_ID_INVALID".to_string());}
        return Ok(style_schema::schema());
    }
    if kind=="outline_generate" {
        return Ok(match stage {
            "editor_text"=>object(&[("title",text()),("content",json!({"type":"string","minLength":1,"maxLength":200_000}))]),
            "volume_candidate"=>optional(object(&[("title",text()),("summary",text())]),&[("goal",text()),("mainConflict",text())]),
            "chapter_candidates"=>object(&[("chapters",list(optional(object(&[("title",text()),("outline",text())]),&[("goal",text()),("targetWordCount",number(500,10_000))]),1,200))]),
            _=>return Err("DOMAIN_OUTLINE_FORMAT_UNKNOWN".to_string()),
        });
    }
    if kind == "setting_suggestions" && stage == "generate_candidates" {
        return Ok(object(&[(
            "items",
            list(
                json!({"type":"object","required":["name"],"properties":{"name":text()},"additionalProperties":{"type":"string","maxLength":20_000}}),
                1,
                50,
            ),
        )]));
    }
    if kind == "autonomous_chapter" && stage.starts_with("review:") {
        return Ok(object(&[
            ("score", number(0, 100)),
            ("accepted", json!({"type":"boolean"})),
            (
                "summary",
                json!({"type":"string","minLength":1,"maxLength":500}),
            ),
            ("issues", strings()),
            ("suggestions", strings()),
        ]));
    }
    if kind == "autonomous_plan" {
        let chapter = number(1, 500);
        return Ok(match stage {
            "foundation" => object(&[
                (
                    "storyBible",
                    object(&[
                        ("title", text()),
                        ("logline", text()),
                        ("themes", strings()),
                        ("protagonistPromise", text()),
                        ("centralQuestion", text()),
                        ("endingVision", text()),
                        ("narrativeRules", strings()),
                    ]),
                ),
                (
                    "arcs",
                    list(
                        entity(&[
                            ("index", number(0, 7)),
                            ("title", text()),
                            ("chapterStart", chapter.clone()),
                            ("chapterEnd", chapter.clone()),
                            ("goal", text()),
                            ("turningPoint", text()),
                            ("climax", text()),
                            ("outcome", text()),
                        ]),
                        1,
                        8,
                    ),
                ),
                (
                    "volumes",
                    list(
                        entity(&[
                            ("index", number(0, 500)),
                            ("title", text()),
                            ("chapterStart", chapter.clone()),
                            ("chapterEnd", chapter.clone()),
                            ("summary", text()),
                            ("goal", text()),
                            ("mainConflict", text()),
                            ("arcIds", strings()),
                            ("materialization", choice(&["create", "existing"])),
                        ]),
                        1,
                        24,
                    ),
                ),
            ]),
            "characters" => object(&[(
                "characters",
                list(
                    optional(entity(&[
                        ("name", text()),
                        (
                            "role",
                            choice(&["protagonist", "supporting", "antagonist", "neutral"]),
                        ),
                        ("identity", text()),
                        ("personality", text()),
                        ("coreNeed", text()),
                        ("flaw", text()),
                        ("initialState", text()),
                        ("desiredEndState", text()),
                        ("behaviorLimits", strings()),
                        ("forbiddenBehaviors", strings()),
                        (
                            "beats",
                            list(
                                optional(entity(&[
                                    ("characterId", text()),
                                    ("chapterNumber", chapter.clone()),
                                    ("stage", text()),
                                    ("change", text()),
                                ]),&[("relationshipShift",text()),("knowledgeGain",text())]),
                                2,
                                100,
                            ),
                        ),
                    ]),&[("faction",text()),("relationToProtagonist",text())]),
                    3,
                    48,
                ),
            )]),
            "world" => object(&[(
                "worldElements",
                list(
                    entity(&[
                        (
                            "type",
                            choice(&[
                                "location",
                                "faction",
                                "rule",
                                "culture",
                                "technology",
                                "artifact",
                            ]),
                        ),
                        ("name", text()),
                        ("summary", text()),
                        ("firstChapter", chapter.clone()),
                        ("dependencies", strings()),
                        ("constraints", strings()),
                    ]),
                    3,
                    100,
                ),
            )]),
            "conflicts" => object(&[(
                "conflicts",
                list(
                    entity(&[
                        ("title", text()),
                        (
                            "type",
                            choice(&["internal", "interpersonal", "faction", "world", "mystery"]),
                        ),
                        ("participants", strings()),
                        ("stakes", text()),
                        ("summary", text()),
                        ("introducedChapter", chapter.clone()),
                        ("escalationChapters", list(chapter.clone(), 0, 100)),
                        ("climaxChapter", chapter.clone()),
                        ("resolutionChapter", chapter.clone()),
                    ]),
                    2,
                    100,
                ),
            )]),
            "pacing" => object(&[
                (
                    "pacingPhases",
                    list(
                        entity(&[
                            ("title", text()),
                            ("chapterStart", chapter.clone()),
                            ("chapterEnd", chapter.clone()),
                            (
                                "mode",
                                choice(&[
                                    "setup",
                                    "build",
                                    "pressure",
                                    "climax",
                                    "recovery",
                                    "resolution",
                                ]),
                            ),
                            ("tensionStart", number(0, 100)),
                            ("tensionEnd", number(0, 100)),
                            ("purpose", text()),
                        ]),
                        1,
                        50,
                    ),
                ),
                (
                    "pacingCurve",
                    list(
                        object(&[
                            ("chapterNumber", chapter.clone()),
                            ("phaseId", text()),
                            (
                                "mode",
                                choice(&[
                                    "setup",
                                    "build",
                                    "pressure",
                                    "climax",
                                    "recovery",
                                    "resolution",
                                ]),
                            ),
                            ("tension", number(0, 100)),
                            ("dialogueRatio", number(0, 100)),
                            ("descriptionRatio", number(0, 100)),
                            ("cliffhanger", json!({"type":"boolean"})),
                        ]),
                        1,
                        500,
                    ),
                ),
            ]),
            stage if stage.starts_with("chapters:") => object(&[(
                "chapters",
                list(
                    entity(&[
                        ("chapterNumber", chapter),
                        ("volumeId", text()),
                        ("arcId", text()),
                        ("title", text()),
                        ("outline", text()),
                        ("goal", text()),
                        ("targetWordCount", number(500, 10_000)),
                        (
                            "pacingMode",
                            choice(&[
                                "setup",
                                "build",
                                "pressure",
                                "climax",
                                "recovery",
                                "resolution",
                            ]),
                        ),
                        ("tension", number(0, 100)),
                        ("endingHook", text()),
                        ("conflictThreadIds", strings()),
                        ("characterIds", strings()),
                        ("characterBeatIds", strings()),
                        ("worldElementIds", strings()),
                        ("status", choice(&["planned"])),
                    ]),
                    1,
                    10,
                ),
            )]),
            _ => return Err("DOMAIN_CANDIDATE_STAGE_UNKNOWN".to_string()),
        });
    }
    Err("DOMAIN_CANDIDATE_STAGE_UNKNOWN".to_string())
}

pub fn validate(schema: &Value, value: &Value) -> Result<(), String> {
    validate_at(schema, value, "$")
}
fn invalid(path: &str) -> String {
    format!("DOMAIN_CANDIDATE_SCHEMA_INVALID: {path}")
}
fn validate_at(schema: &Value, value: &Value, path: &str) -> Result<(), String> {
    if let Some(choices) = schema["enum"].as_array() {
        if !choices.contains(value) {
            return Err(invalid(path));
        }
    }
    match schema["type"].as_str() {
        Some("object") => {
            let object = value.as_object().ok_or_else(|| invalid(path))?;
            if object.len() > 200 {
                return Err(invalid(path));
            }
            if let Some(required) = schema["required"].as_array() {
                for key in required.iter().filter_map(Value::as_str) {
                    if !object.contains_key(key) {
                        return Err(invalid(&format!("{path}.{key}")));
                    }
                }
            }
            for (key, value) in object {
                let field = schema["properties"].get(key);
                if let Some(field) = field {
                    validate_at(field, value, &format!("{path}.{key}"))?;
                } else if schema["additionalProperties"] == false {
                    return Err(invalid(&format!("{path}.{key}")));
                } else if schema["additionalProperties"].is_object() {
                    validate_at(
                        &schema["additionalProperties"],
                        value,
                        &format!("{path}.{key}"),
                    )?;
                }
            }
        }
        Some("array") => {
            let values = value.as_array().ok_or_else(|| invalid(path))?;
            if values.len() < schema["minItems"].as_u64().unwrap_or(0) as usize
                || values.len() > schema["maxItems"].as_u64().unwrap_or(500) as usize
            {
                return Err(invalid(path));
            }
            for (index, item) in values.iter().enumerate() {
                validate_at(&schema["items"], item, &format!("{path}[{index}]"))?;
            }
        }
        Some("string") => {
            let text = value.as_str().ok_or_else(|| invalid(path))?;
            if text.trim().chars().count() < schema["minLength"].as_u64().unwrap_or(0) as usize
                || text.chars().count() > schema["maxLength"].as_u64().unwrap_or(10_000) as usize
            {
                return Err(invalid(path));
            }
        }
        Some("number")=>{
            let number=value.as_f64().filter(|number|number.is_finite()).ok_or_else(||invalid(path))?;
            if schema["minimum"].as_f64().is_some_and(|min|number<min)||schema["maximum"].as_f64().is_some_and(|max|number>max){return Err(invalid(path));}
        },
        Some("integer") => {
            let number = value.as_i64().ok_or_else(|| invalid(path))?;
            if number < schema["minimum"].as_i64().unwrap_or(i64::MIN)
                || number > schema["maximum"].as_i64().unwrap_or(i64::MAX)
            {
                return Err(invalid(path));
            }
        }
        Some("boolean") => {
            if !value.is_boolean() {
                return Err(invalid(path));
            }
        }
        None => {}
        _ => return Err(invalid(path)),
    }
    Ok(())
}
