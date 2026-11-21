use clap::{Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(name = "deepb", about = "Rust CLI scaffold for DeepBlock", version)]
pub struct Cli {
    #[arg(long, global = true, env = "DEEPBLOCK_SERVER_URL")]
    pub server: Option<String>,
    #[arg(long, global = true)]
    pub json: bool,
    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Annotate voluntary feedback without revising the schedule.
    Outcome {
        block_id: String,
        #[arg(long)]
        date: Option<String>,
        #[arg(long, conflicts_with = "clear_actual_duration")]
        actual_duration: Option<u16>,
        #[arg(long, conflicts_with = "clear_focus_rating")]
        focus_rating: Option<u8>,
        #[arg(long, conflicts_with = "clear_completed", action = clap::ArgAction::Set)]
        completed: Option<bool>,
        #[arg(long)]
        clear_actual_duration: bool,
        #[arg(long)]
        clear_focus_rating: bool,
        #[arg(long)]
        clear_completed: bool,
    },
    /// Offline migration, export and recovery (stop the server first).
    Storage {
        #[command(subcommand)]
        command: StorageCommand,
    },
    List {
        #[arg(long)]
        date: Option<String>,
    },
    Add {
        label: String,
        #[arg(long)]
        start: String,
        #[arg(long)]
        duration: u16,
        #[arg(long = "type", default_value = "shallow")]
        block_type: String,
    },
    Edit {
        block_id: String,
        #[arg(long)]
        label: Option<String>,
        #[arg(long)]
        start: Option<String>,
        #[arg(long)]
        duration: Option<u16>,
        #[arg(long = "type", value_parser = ["focus", "shallow", "urgent", "break"])]
        block_type: Option<String>,
        #[arg(long, value_parser = ["proposed", "confirmed", "cancelled", "done"])]
        status: Option<String>,
        #[arg(long)]
        focus_rating: Option<u8>,
        #[arg(long)]
        actual_duration: Option<u16>,
        #[arg(long)]
        next_action: Option<String>,
        #[arg(long)]
        content_path: Option<String>,
    },
    Delete {
        block_id: String,
    },
    Move {
        block_id: String,
        #[arg(value_parser = ["up", "down"])]
        direction: String,
    },
    Reposition {
        block_id: String,
        #[arg(long)]
        start: String,
    },
    Artifact {
        #[command(subcommand)]
        command: ArtifactCommand,
    },
    Revise {
        #[arg(long)]
        reason: Option<String>,
        #[arg(long, value_parser = ["all", "from_now", "empty"])]
        copy_mode: Option<String>,
    },
    Compare {
        #[arg(long)]
        base: Option<String>,
        #[arg(long)]
        compare: Option<String>,
    },
    Undo,
    Redo,
    Note {
        #[command(subcommand)]
        command: NoteCommand,
    },
    Backlog {
        #[command(subcommand)]
        command: BacklogCommand,
    },
    Config {
        #[command(subcommand)]
        command: ConfigCommand,
    },
    Mode {
        #[arg(value_parser = ["focus", "reflect"])]
        mode: Option<String>,
    },
    Aw {
        #[command(subcommand)]
        command: AwCommand,
    },
    Serve {
        #[arg(long)]
        host: Option<String>,
        #[arg(long)]
        port: Option<u16>,
    },
    Status,
    Stop,
    Review,
    Check,
    Open,
}

#[derive(Debug, Subcommand)]
pub enum StorageCommand {
    Export {
        destination: std::path::PathBuf,
    },
    Backup {
        destination: std::path::PathBuf,
    },
    Import {
        source: std::path::PathBuf,
        destination: std::path::PathBuf,
    },
    Restore {
        source: std::path::PathBuf,
        destination: std::path::PathBuf,
    },
}

#[derive(Debug, Subcommand)]
pub enum ArtifactCommand {
    Add { block_id: String, artifact: String },
    Remove { block_id: String, artifact: String },
}

#[derive(Debug, Subcommand)]
pub enum NoteCommand {
    Ensure,
    Show {
        #[arg(long)]
        date: Option<String>,
    },
    Save {
        #[arg(long)]
        date: Option<String>,
        #[arg(long)]
        content: String,
    },
}

#[derive(Debug, Subcommand)]
pub enum BacklogCommand {
    List,
    Add {
        label: String,
    },
    Update {
        task_id: String,
        #[arg(value_parser = ["todo", "inprogress", "done"])]
        status: String,
    },
    Delete {
        task_id: String,
    },
}

#[derive(Debug, Subcommand)]
pub enum ConfigCommand {
    Get,
    Set {
        #[arg(long)]
        notifications_enabled: Option<bool>,
        #[arg(long)]
        notify_minutes_before: Option<u16>,
        #[arg(long)]
        notify_on_block_start: Option<bool>,
        #[arg(long)]
        notify_on_block_end: Option<bool>,
    },
}

#[derive(Debug, Subcommand)]
pub enum AwCommand {
    Status,
    Doctor,
}

#[cfg(test)]
mod tests {
    use clap::Parser;

    use super::{
        ArtifactCommand, AwCommand, BacklogCommand, Cli, Command, ConfigCommand, NoteCommand,
    };

    #[test]
    fn parses_add_command() {
        let cli = Cli::parse_from([
            "deepb",
            "add",
            "Deep Work",
            "--start",
            "09:00",
            "--duration",
            "90",
        ]);

        match cli.command {
            Some(Command::Add {
                label, duration, ..
            }) => {
                assert_eq!(label, "Deep Work");
                assert_eq!(duration, 90);
            }
            other => panic!("unexpected command: {other:?}"),
        }
    }

    #[test]
    fn defaults_to_plain_output() {
        let cli = Cli::parse_from(["deepb", "list"]);
        assert!(!cli.json);
        assert!(cli.server.is_none());
    }

    #[test]
    fn parses_edit_command_with_optional_fields() {
        let cli = Cli::parse_from([
            "deepb",
            "edit",
            "block-1",
            "--label",
            "Refined Work",
            "--status",
            "confirmed",
            "--focus-rating",
            "5",
        ]);

        match cli.command {
            Some(Command::Edit {
                block_id,
                label,
                status,
                focus_rating,
                ..
            }) => {
                assert_eq!(block_id, "block-1");
                assert_eq!(label.as_deref(), Some("Refined Work"));
                assert_eq!(status.as_deref(), Some("confirmed"));
                assert_eq!(focus_rating, Some(5));
            }
            other => panic!("unexpected command: {other:?}"),
        }
    }

    #[test]
    fn parses_nested_backlog_command() {
        let cli = Cli::parse_from(["deepb", "backlog", "update", "task-1", "done"]);

        match cli.command {
            Some(Command::Backlog {
                command: BacklogCommand::Update { task_id, status },
            }) => {
                assert_eq!(task_id, "task-1");
                assert_eq!(status, "done");
            }
            other => panic!("unexpected command: {other:?}"),
        }
    }

    #[test]
    fn parses_note_save_command() {
        let cli = Cli::parse_from([
            "deepb",
            "note",
            "save",
            "--date",
            "2026-04-16",
            "--content",
            "Ship it",
        ]);

        match cli.command {
            Some(Command::Note {
                command: NoteCommand::Save { date, content },
            }) => {
                assert_eq!(date.as_deref(), Some("2026-04-16"));
                assert_eq!(content, "Ship it");
            }
            other => panic!("unexpected command: {other:?}"),
        }
    }

    #[test]
    fn parses_review_command() {
        let cli = Cli::parse_from(["deepb", "review"]);
        assert!(matches!(cli.command, Some(Command::Review)));
    }

    #[test]
    fn parses_config_set_notification_flags() {
        let cli = Cli::parse_from([
            "deepb",
            "config",
            "set",
            "--notifications-enabled",
            "false",
            "--notify-minutes-before",
            "0",
            "--notify-on-block-start",
            "true",
        ]);

        match cli.command {
            Some(Command::Config {
                command:
                    ConfigCommand::Set {
                        notifications_enabled,
                        notify_minutes_before,
                        notify_on_block_start,
                        notify_on_block_end,
                    },
            }) => {
                assert_eq!(notifications_enabled, Some(false));
                assert_eq!(notify_minutes_before, Some(0));
                assert_eq!(notify_on_block_start, Some(true));
                assert_eq!(notify_on_block_end, None);
            }
            other => panic!("unexpected command: {other:?}"),
        }
    }

    #[test]
    fn parses_artifact_remove_command() {
        let cli = Cli::parse_from([
            "deepb",
            "artifact",
            "remove",
            "block-1",
            "https://example.com/pr/1",
        ]);

        match cli.command {
            Some(Command::Artifact {
                command: ArtifactCommand::Remove { block_id, artifact },
            }) => {
                assert_eq!(block_id, "block-1");
                assert_eq!(artifact, "https://example.com/pr/1");
            }
            other => panic!("unexpected command: {other:?}"),
        }
    }

    #[test]
    fn parses_config_get_command() {
        let cli = Cli::parse_from(["deepb", "config", "get"]);

        match cli.command {
            Some(Command::Config {
                command: ConfigCommand::Get,
            }) => {}
            other => panic!("unexpected command: {other:?}"),
        }
    }

    #[test]
    fn parses_aw_doctor_command() {
        let cli = Cli::parse_from(["deepb", "aw", "doctor"]);

        match cli.command {
            Some(Command::Aw {
                command: AwCommand::Doctor,
            }) => {}
            other => panic!("unexpected command: {other:?}"),
        }
    }
}
