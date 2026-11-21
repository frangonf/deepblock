use crate::{
    context::{ContextCatalog, IntentSnapshot},
    error::{AppError, AppResult},
    models::validate_date_param,
    state::AppState,
};
use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CatalogUpdate {
    pub base: ContextCatalog,
    pub catalog: ContextCatalog,
}

pub async fn get_catalog(State(state): State<AppState>) -> AppResult<Json<ContextCatalog>> {
    Ok(Json(
        state
            .io(|s| {
                Ok(s.planning_store()?
                    .load_resource("context")?
                    .unwrap_or_default())
            })
            .await?,
    ))
}

pub async fn update_catalog(
    State(state): State<AppState>,
    Json(update): Json<CatalogUpdate>,
) -> AppResult<Json<ContextCatalog>> {
    update.catalog.validate()?;
    let catalog = state
        .io(move |s| {
            s.planning_store()?
                .update_catalog(&update.base, &update.catalog)?;
            Ok(update.catalog)
        })
        .await?;
    state.events.send_refresh("context_updated");
    Ok(Json(catalog))
}

#[derive(Default, Deserialize)]
pub struct IntentQuery {
    pub at: Option<String>,
}

pub async fn get_intents(
    State(state): State<AppState>,
    Path(date): Path<String>,
) -> AppResult<Json<Vec<IntentSnapshot>>> {
    validate_date_param(&date)?;
    Ok(Json(
        state
            .io(move |s| s.planning_store()?.intents(&date))
            .await?,
    ))
}

pub async fn get_effective_intent(
    State(state): State<AppState>,
    Path(date): Path<String>,
    Query(query): Query<IntentQuery>,
) -> AppResult<Json<Option<IntentSnapshot>>> {
    validate_date_param(&date)?;
    let at = query.at.unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
    let parsed = chrono::DateTime::parse_from_rfc3339(&at)
        .map_err(|_| AppError::BadRequest("Intent lookup requires an RFC3339 timestamp".into()))?;
    let at = parsed
        .with_timezone(&chrono::Utc)
        .to_rfc3339_opts(chrono::SecondsFormat::Nanos, true);
    Ok(Json(
        state
            .io(move |s| s.planning_store()?.effective_intent(&date, &at))
            .await?,
    ))
}
