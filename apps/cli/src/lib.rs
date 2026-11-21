mod activitywatch;
mod cli;
mod client;
mod output;

use anyhow::{Result, anyhow};
use clap::Parser;

use crate::{
    cli::{ArtifactCommand, AwCommand, BacklogCommand, Cli, Command, ConfigCommand, NoteCommand},
    client::{
        DeepBlockClient, parse_block_status, parse_block_type, read_pid, resolve_base_url,
        stop_server_process,
    },
    output::{print_backlog, print_json, print_plan, print_review, print_status},
};

pub async fn run() -> Result<()> {
    let cli = Cli::parse();
    // Resolve only for HTTP commands. Local recovery (`stop`) must work
    // even when the storage owner's health endpoint is unresponsive.
    let client_base_url = || resolve_base_url(cli.server.clone());

    match cli.command.unwrap_or(Command::List { date: None }) {
        Command::Outcome {
            block_id,
            date,
            actual_duration,
            focus_rating,
            completed,
            clear_actual_duration,
            clear_focus_rating,
            clear_completed,
        } => {
            let request = deepblock_server::models::BlockOutcomeRequest {
                actual_duration: if clear_actual_duration {
                    Some(None)
                } else {
                    actual_duration.map(Some)
                },
                focus_rating: if clear_focus_rating {
                    Some(None)
                } else {
                    focus_rating.map(Some)
                },
                completed: if clear_completed {
                    Some(None)
                } else {
                    completed.map(Some)
                },
            };
            if request.actual_duration.is_none()
                && request.focus_rating.is_none()
                && request.completed.is_none()
            {
                return Err(anyhow!("Provide feedback or an explicit --clear-* flag"));
            }
            let date = date.unwrap_or_else(deepblock_server::models::today_string);
            let client = DeepBlockClient::new(client_base_url().await?);
            let plan = client.outcome(&block_id, &date, &request).await?;
            if cli.json {
                print_json(&plan)?;
            } else {
                print_plan(&plan);
            }
        }
        Command::Storage { command } => {
            use cli::StorageCommand;
            use deepblock_server::{config::DeepBlockPaths, storage};
            let paths = DeepBlockPaths::resolve()?;
            tokio::task::spawn_blocking(move || match command {
                StorageCommand::Export { destination } => {
                    storage::export_offline(&paths, &destination)
                }
                StorageCommand::Backup { destination } => {
                    storage::backup_offline(&paths, &destination)
                }
                StorageCommand::Import {
                    source,
                    destination,
                } => storage::import_new(&source, &destination),
                StorageCommand::Restore {
                    source,
                    destination,
                } => storage::restore_backup(&source, &destination),
            })
            .await??;
            println!("Storage operation completed.");
        }
        Command::List { date } => {
            let client = DeepBlockClient::new(client_base_url().await?);
            let plan = client.get_plan(date.as_deref()).await?;
            if cli.json {
                print_json(&plan)?;
            } else {
                print_plan(&plan);
            }
        }
        Command::Add {
            label,
            start,
            duration,
            block_type,
        } => {
            let client = DeepBlockClient::new(client_base_url().await?);
            let plan = client.add_block(label, start, duration, block_type).await?;
            if cli.json {
                print_json(&plan)?;
            } else {
                print_plan(&plan);
            }
        }
        Command::Edit {
            block_id,
            label,
            start,
            duration,
            block_type,
            status,
            focus_rating,
            actual_duration,
            next_action,
            content_path,
        } => {
            let client = DeepBlockClient::new(client_base_url().await?);
            let request = deepblock_server::models::UpdateBlockRequest {
                project_id: None,
                goal_id: None,
                label,
                start,
                duration,
                block_type: block_type.as_deref().map(parse_block_type).transpose()?,
                metadata: None,
                focus_rating: focus_rating.map(Some),
                actual_duration: actual_duration.map(Some),
                next_action: next_action.map(Some),
                content_path: content_path.map(Some),
                status: status.as_deref().map(parse_block_status).transpose()?,
                artifacts: None,
                force_revision: false,
            };
            let plan = client.edit_block(&block_id, request).await?;
            if cli.json {
                print_json(&plan)?;
            } else {
                print_plan(&plan);
            }
        }
        Command::Delete { block_id } => {
            let client = DeepBlockClient::new(client_base_url().await?);
            let plan = client.delete_block(&block_id).await?;
            if cli.json {
                print_json(&plan)?;
            } else {
                print_plan(&plan);
            }
        }
        Command::Move {
            block_id,
            direction,
        } => {
            let client = DeepBlockClient::new(client_base_url().await?);
            let plan = client.move_block(&block_id, direction).await?;
            if cli.json {
                print_json(&plan)?;
            } else {
                print_plan(&plan);
            }
        }
        Command::Reposition { block_id, start } => {
            let client = DeepBlockClient::new(client_base_url().await?);
            let plan = client.reposition_block(&block_id, start).await?;
            if cli.json {
                print_json(&plan)?;
            } else {
                print_plan(&plan);
            }
        }
        Command::Artifact { command } => {
            let client = DeepBlockClient::new(client_base_url().await?);
            let plan = match command {
                ArtifactCommand::Add { block_id, artifact } => {
                    client.add_artifact(&block_id, artifact).await?
                }
                ArtifactCommand::Remove { block_id, artifact } => {
                    client.remove_artifact(&block_id, artifact).await?
                }
            };
            if cli.json {
                print_json(&plan)?;
            } else {
                print_plan(&plan);
            }
        }
        Command::Revise { reason, copy_mode } => {
            let client = DeepBlockClient::new(client_base_url().await?);
            let plan = client.revise(reason, copy_mode).await?;
            if cli.json {
                print_json(&plan)?;
            } else {
                print_plan(&plan);
            }
        }
        Command::Compare { base, compare } => {
            let client = DeepBlockClient::new(client_base_url().await?);
            let comparison = client.compare(base, compare).await?;
            if cli.json {
                print_json(&comparison)?;
            } else {
                println!("{}", comparison.summary);
            }
        }
        Command::Undo => {
            let client = DeepBlockClient::new(client_base_url().await?);
            let plan = client.undo().await?;
            if cli.json {
                print_json(&plan)?;
            } else {
                print_plan(&plan);
            }
        }
        Command::Redo => {
            let client = DeepBlockClient::new(client_base_url().await?);
            let plan = client.redo().await?;
            if cli.json {
                print_json(&plan)?;
            } else {
                print_plan(&plan);
            }
        }
        Command::Note { command } => {
            let client = DeepBlockClient::new(client_base_url().await?);
            match command {
                NoteCommand::Ensure => {
                    let response = client.ensure_note().await?;
                    if cli.json {
                        print_json(&response)?;
                    } else {
                        println!("{}", response.path);
                    }
                }
                NoteCommand::Show { date } => {
                    let response = client.get_note(date.as_deref()).await?;
                    if cli.json {
                        print_json(&response)?;
                    } else {
                        println!("{}", response.content);
                    }
                }
                NoteCommand::Save { date, content } => {
                    let response = client.save_note(date.as_deref(), content).await?;
                    if cli.json {
                        print_json(&response)?;
                    } else {
                        println!("{}", response.content);
                    }
                }
            }
        }
        Command::Backlog { command } => {
            let client = DeepBlockClient::new(client_base_url().await?);
            let backlog = match command {
                BacklogCommand::List => client.get_backlog().await?,
                BacklogCommand::Add { label } => client.add_backlog_task(label).await?,
                BacklogCommand::Update { task_id, status } => {
                    client.update_backlog_task(&task_id, status).await?
                }
                BacklogCommand::Delete { task_id } => client.delete_backlog_task(&task_id).await?,
            };
            if cli.json {
                print_json(&backlog)?;
            } else {
                print_backlog(&backlog);
            }
        }
        Command::Config { command } => {
            let client = DeepBlockClient::new(client_base_url().await?);
            match command {
                ConfigCommand::Get => {
                    let config = client.get_config().await?;
                    print_json(&config)?;
                }
                ConfigCommand::Set {
                    notifications_enabled,
                    notify_minutes_before,
                    notify_on_block_start,
                    notify_on_block_end,
                } => {
                    if notifications_enabled.is_none()
                        && notify_minutes_before.is_none()
                        && notify_on_block_start.is_none()
                        && notify_on_block_end.is_none()
                    {
                        return Err(anyhow!(
                            "config set requires at least one notification flag"
                        ));
                    }

                    let config = client
                        .patch_config(deepblock_server::models::ClientConfigUpdate {
                            notifications_enabled,
                            notify_minutes_before,
                            notify_on_block_start,
                            notify_on_block_end,
                            ..Default::default()
                        })
                        .await?;
                    print_json(&config)?;
                }
            }
        }
        Command::Mode { mode } => {
            let client = DeepBlockClient::new(client_base_url().await?);
            let response = if let Some(mode) = mode {
                client.set_mode(mode).await?
            } else {
                client.get_mode().await?
            };
            if cli.json {
                print_json(&response)?;
            } else {
                println!("mode: {:?}", response.mode);
            }
        }
        Command::Aw { command } => match command {
            AwCommand::Status => activitywatch::print_status(cli.json).await?,
            AwCommand::Doctor => activitywatch::print_doctor(cli.json).await?,
        },
        Command::Serve { host, port } => {
            deepblock_server::serve(host, port).await?;
        }
        Command::Status => {
            let client = DeepBlockClient::new(client_base_url().await?);
            let health = client.health().await?;
            let pid = if cli.server.is_none() {
                read_pid().ok()
            } else {
                None
            };
            if cli.json {
                print_json(&serde_json::json!({
                    "status": health.status,
                    "version": health.version,
                    "pid": pid,
                }))?;
            } else {
                print_status(&health.status, &health.version, pid);
            }
        }
        Command::Stop => {
            stop_server_process()?;
            if cli.json {
                print_json(&serde_json::json!({ "status": "stopped" }))?;
            } else {
                println!("server stop signal sent");
            }
        }
        Command::Review => {
            let client = DeepBlockClient::new(client_base_url().await?);
            let review = client.review().await?;
            if cli.json {
                print_json(&review)?;
            } else {
                print_review(&review);
            }
        }
        Command::Check => {
            let client = DeepBlockClient::new(client_base_url().await?);
            let plan = client.audit().await?;
            if cli.json {
                print_json(&plan)?;
            } else {
                print_plan(&plan);
            }
        }
        Command::Open => {
            let client = DeepBlockClient::new(client_base_url().await?);
            if client.health().await.is_err() {
                return Err(anyhow!(
                    "server is not reachable; run `deepb serve` or `mise run dev:server` first"
                ));
            }
            client.open_ui()?;
            if cli.json {
                print_json(&serde_json::json!({ "status": "opened", "url": client.ui_url() }))?;
            } else {
                println!("opened {}", client.ui_url());
            }
        }
    }

    Ok(())
}
