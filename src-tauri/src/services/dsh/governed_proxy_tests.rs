    use super::*;
    use serde_json::Value;

    fn post(url: &str, path: &str, payload: Value) -> (u16, Value) {
        let address = url.trim_start_matches("http://");
        let body = serde_json::to_vec(&payload).expect("serialize control payload");
        let mut stream = TcpStream::connect(address).expect("connect policy server");
        let request = format!(
            "POST {} HTTP/1.1\r\nhost: {}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
            path,
            address,
            body.len()
        );
        stream
            .write_all(request.as_bytes())
            .expect("write control headers");
        stream.write_all(&body).expect("write control body");
        stream.flush().expect("flush control request");
        let mut response = Vec::new();
        stream
            .read_to_end(&mut response)
            .expect("read control response");
        let response = String::from_utf8(response).expect("utf8 control response");
        let (head, body) = response.split_once("\r\n\r\n").expect("response frame");
        let status = head
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|value| value.parse::<u16>().ok())
            .expect("response status");
        (
            status,
            serde_json::from_str(body).expect("response json body"),
        )
    }

    fn policy(owner_id: String) -> GovernedProxyPolicy {
        GovernedProxyPolicy {
            owner_id,
            max_requests_per_minute: 120,
            max_concurrent_requests: 8,
            daily_token_budget: Some(1_000_000),
            daily_cost_budget_usd: Some(100.0),
            input_price_per_million_tokens: Some(1.0),
            output_price_per_million_tokens: Some(2.0),
            warning_percent: 80,
            ttl_ms: 60_000,
        }
    }

    #[test]
    fn control_server_tracks_real_request_identity_and_conservatively_closes_leases() {
        crate::db::init_test_database();
        let suffix = uuid::Uuid::new_v4().to_string();
        let guard = start_policy_server(policy(format!("dsh-test-owner-{suffix}")))
            .expect("start policy server");
        let first_request = format!("dsh-test-request-{suffix}-1");
        let (status, reserve) = post(
            &guard.url(),
            "/reserve",
            json!({
                "providerRequestId":first_request,
                "estimatedInputTokens":20,
                "estimatedOutputTokens":30
            }),
        );
        assert_eq!(status, 200);
        let ticket = reserve
            .get("ticket")
            .and_then(Value::as_str)
            .expect("opaque ticket")
            .to_string();
        let identity = guard
            .request_identity_reader()
            .lock()
            .expect("identity reader")
            .clone()
            .expect("latest identity");
        assert_eq!(identity.provider_request_id, first_request);
        let (status, settled) = post(
            &guard.url(),
            "/settle",
            json!({
                "ticket":ticket,
                "outcome":"succeeded",
                "tokenInput":11,
                "tokenOutput":7
            }),
        );
        assert_eq!(status, 200);
        assert_eq!(settled.get("settled").and_then(Value::as_bool), Some(true));
        let first_row: (String, i64, i64) = crate::db::get_connection()
            .lock()
            .expect("database")
            .query_row(
                "SELECT status, accounted_input_tokens, accounted_output_tokens
                 FROM ai_request_reservations WHERE reservation_id=?1",
                rusqlite::params![identity.reservation_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("settled reservation");
        assert_eq!(first_row, ("settled".to_string(), 11, 7));

        let second_request = format!("dsh-test-request-{suffix}-2");
        assert_eq!(
            post(
                &guard.url(),
                "/reserve",
                json!({
                    "providerRequestId":second_request,
                    "estimatedInputTokens":40,
                    "estimatedOutputTokens":60
                }),
            )
            .0,
            200
        );
        let second_identity = guard
            .request_identity_reader()
            .lock()
            .expect("identity reader")
            .clone()
            .expect("second identity");
        drop(guard);
        let second_row: (String, i64, i64) = crate::db::get_connection()
            .lock()
            .expect("database")
            .query_row(
                "SELECT status, accounted_input_tokens, accounted_output_tokens
                 FROM ai_request_reservations WHERE reservation_id=?1",
                rusqlite::params![second_identity.reservation_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("conservatively settled reservation");
        assert_eq!(second_row, ("failed".to_string(), 40, 60));
    }
