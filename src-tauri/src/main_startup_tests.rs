use super::{run_instance_guarded_startup, InstanceStartup};
use std::cell::RefCell;
use std::path::PathBuf;

#[test]
fn secondary_instance_requests_focus_without_initializing_database() {
    let events = RefCell::new(Vec::new());
    let app_data_dir = PathBuf::from("test-app-data");

    let result = run_instance_guarded_startup(
        &app_data_dir,
        |_| {
            events.borrow_mut().push("instance-check");
            false
        },
        |_| events.borrow_mut().push("focus-request"),
        || events.borrow_mut().push("database-initialization"),
    );

    assert_eq!(result, InstanceStartup::Secondary);
    assert_eq!(events.into_inner(), ["instance-check", "focus-request"]);
}

#[test]
fn primary_instance_initializes_database_after_acquiring_lock() {
    let events = RefCell::new(Vec::new());
    let app_data_dir = PathBuf::from("test-app-data");

    let result = run_instance_guarded_startup(
        &app_data_dir,
        |_| {
            events.borrow_mut().push("instance-check");
            true
        },
        |_| events.borrow_mut().push("focus-request"),
        || events.borrow_mut().push("database-initialization"),
    );

    assert_eq!(result, InstanceStartup::Primary);
    assert_eq!(
        events.into_inner(),
        ["instance-check", "database-initialization"]
    );
}
