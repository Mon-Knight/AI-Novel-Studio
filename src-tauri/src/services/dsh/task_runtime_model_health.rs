use super::{
    active, ensure_plugin_probe_health, large_text_repository, probe_input, provider_transport,
    read_matching_plugin_probe_health, read_process_health, ProviderTransport, SelectedModelRoute,
    PLUGIN_PROBE_CONVERSATION_ID,
};
use serde_json::Value;

pub(super) fn task_worker_health_matches_model(
    worker_route: &SelectedModelRoute,
    worker_credential_hash: &str,
    desired_transport: Option<&ProviderTransport>,
) -> bool {
    desired_transport.is_none_or(|desired| {
        worker_route == &desired.route
            && worker_credential_hash == large_text_repository::sha256(&desired.upstream_key)
    })
}

/// Reads the public health projection from an idle task worker, or a dedicated
/// plugin-probe worker when the user has not started a task yet.
///
/// A running/cancelling worker is never probed. Callers must treat `None` as
/// "not initialized", not as healthy. Probe spawn failures stay `None` so the
/// plugin view can remain unavailable instead of guessing loaded.
pub fn runtime_health_with_probe(
    conversation_id: Option<&str>,
    allow_probe: bool,
    model_snapshot: Option<&Value>,
    api_key: Option<&str>,
) -> Result<Option<Value>, String> {
    // An idle worker may still belong to the model used by the previous turn.
    // Validate the requested identity before consulting caches; an invalid or
    // differently routed selection must never inherit that worker's directory.
    let desired_transport = model_snapshot
        .map(|snapshot| {
            let input = probe_input(Some(snapshot), api_key)?;
            provider_transport(&input)
        })
        .transpose()?;
    if let Some(conversation_id) = conversation_id
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != PLUGIN_PROBE_CONVERSATION_ID)
    {
        let workers = active()
            .lock()
            .map_err(|_| "Worker 状态锁失败".to_string())?;
        if let Some(worker) = workers.get(conversation_id) {
            if worker.status == "idle" {
                let process = worker
                    .process
                    .lock()
                    .map_err(|_| "Worker 进程锁失败".to_string())?
                    .clone();
                drop(workers);
                if let Some(process) = process {
                    if task_worker_health_matches_model(
                        &process.model_route,
                        &process.credential_hash,
                        desired_transport.as_ref(),
                    ) {
                        return Ok(Some(read_process_health(&process)?));
                    }
                }
            }
        }
    }
    if let Some(health) = read_matching_plugin_probe_health(model_snapshot, api_key)? {
        return Ok(Some(health));
    }
    if allow_probe {
        return ensure_plugin_probe_health(model_snapshot, api_key);
    }
    Ok(None)
}
