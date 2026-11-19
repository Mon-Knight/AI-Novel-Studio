//! Exact StyleAnalyzeResult structure. Ratios remain numbers in 0..=1.
use serde_json::{json,Value};
pub(super) fn schema()->Value{
    let bounded=json!({"type":"string","maxLength":2000});
    let ratio=json!({"type":"number","minimum":0,"maximum":1});
    let mut fields=vec![];
    for name in ["name","narrativePerspective","tone","pace","sentenceStyle","battleStyle","battleIntensity","emotionTendency","chapterEnding"]{fields.push((name,bounded.clone()));}
    for name in ["dialogueRatio","descriptionRatio","psychologicalRatio"]{fields.push((name,ratio.clone()));}
    fields.push(("forbiddenStyles",super::list(bounded,0,100)));
    super::optional(super::object(&[("styleSummary",json!({"type":"string","minLength":1,"maxLength":10_000}))]),&fields)
}
