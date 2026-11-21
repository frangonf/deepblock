#[tokio::main]
async fn main() -> anyhow::Result<()> {
    deepblock_cli::run().await
}
