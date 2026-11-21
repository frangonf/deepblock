use axum::{
    Json,
    extract::{Path, State},
};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{Backlog, BacklogStatus, CreateBacklogTaskRequest, UpdateBacklogTaskRequest},
    state::AppState,
};

fn next_backlog_task_id(backlog: &[Backlog]) -> String {
    loop {
        let candidate = Uuid::new_v4().to_string()[..8].to_string();
        if backlog.iter().all(|task| task.id != candidate) {
            return candidate;
        }
    }
}

pub async fn get_backlog(State(state): State<AppState>) -> AppResult<Json<Vec<Backlog>>> {
    Ok(Json(state.load_backlog_async().await?))
}

pub async fn create_backlog_task(
    State(state): State<AppState>,
    Json(request): Json<CreateBacklogTaskRequest>,
) -> AppResult<Json<Vec<Backlog>>> {
    let label = request.label.trim().to_string();
    if label.is_empty() {
        return Err(AppError::BadRequest(
            "Backlog task label cannot be empty".to_string(),
        ));
    }

    let _guard = state.backlog_lock.lock().await;
    let mut backlog = state.load_backlog_async().await?;
    backlog.push(Backlog {
        id: next_backlog_task_id(&backlog),
        label,
        status: BacklogStatus::Todo,
    });

    state.save_backlog_async(&backlog).await?;
    state.events.send_refresh("backlog_created");

    Ok(Json(backlog))
}

pub async fn update_backlog_task(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
    Json(request): Json<UpdateBacklogTaskRequest>,
) -> AppResult<Json<Vec<Backlog>>> {
    let _guard = state.backlog_lock.lock().await;
    let mut backlog = state.load_backlog_async().await?;
    let task = backlog
        .iter_mut()
        .find(|task| task.id == task_id)
        .ok_or_else(|| AppError::NotFound(format!("Backlog task '{task_id}' was not found")))?;

    task.status = request.status;

    state.save_backlog_async(&backlog).await?;
    state.events.send_refresh("backlog_updated");

    Ok(Json(backlog))
}

pub async fn delete_backlog_task(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
) -> AppResult<Json<Vec<Backlog>>> {
    let _guard = state.backlog_lock.lock().await;
    let mut backlog = state.load_backlog_async().await?;
    let task_index = backlog
        .iter()
        .position(|task| task.id == task_id)
        .ok_or_else(|| AppError::NotFound(format!("Backlog task '{task_id}' was not found")))?;

    backlog.remove(task_index);

    state.save_backlog_async(&backlog).await?;
    state.events.send_refresh("backlog_deleted");

    Ok(Json(backlog))
}
