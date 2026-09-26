use std::error::Error;
fn main() {
    let url = std::env::args().nth(1).expect("HOST URL");
    tauri::async_runtime::block_on(async {
        for mode in ["default", "direct", "http1"] {
            let mut builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(15));
            if mode == "direct" { builder = builder.no_proxy(); }
            if mode == "http1" { builder = builder.http1_only(); }
            match builder.build().unwrap().get(&url).send().await {
                Ok(r) => println!("mode={mode} http={}", r.status().as_u16()),
                Err(e) => {
                    println!("mode={mode} connect={} timeout={}", e.is_connect(), e.is_timeout());
                    let mut source = e.source();
                    while let Some(cause) = source {
                        let s = cause.to_string();
                        let safe = if s.contains("http") { "[URL redacted]" } else { &s };
                        println!("cause={safe}"); source = cause.source();
                    }
                }
            }
        }
    });
}
