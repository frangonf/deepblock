#[tokio::main]
async fn main() -> Result<(), deepblock_server::error::AppError> {
    deepblock_server::serve(None, None).await
}
