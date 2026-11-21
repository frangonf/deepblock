-- Planning writer only. Observation workers never open this database.
CREATE TABLE days (
    date TEXT PRIMARY KEY NOT NULL,
    document TEXT NOT NULL CHECK(json_valid(document))
);
CREATE TABLE resources (
    key TEXT PRIMARY KEY NOT NULL,
    document TEXT NOT NULL CHECK(json_valid(document))
);
CREATE TABLE intents (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    version TEXT NOT NULL UNIQUE,
    date TEXT NOT NULL REFERENCES days(date),
    recorded_at TEXT NOT NULL,
    document TEXT NOT NULL CHECK(json_valid(document))
);
CREATE INDEX intent_effective ON intents(date, recorded_at, sequence);
CREATE TABLE dataset (singleton INTEGER PRIMARY KEY CHECK(singleton=1), generation TEXT NOT NULL);
PRAGMA user_version = 2;
