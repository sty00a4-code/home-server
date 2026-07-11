-- Schema for the "studies" app — a personal Leistungsübersicht tracker,
-- modeled on how JGU Mainz's JOGU-StINe portal actually structures things:
--
--   Studiengang (study_programs)
--     -> Prüfungsordnungsbereich (po_areas)         [e.g. Kernfach, Beifach]
--          -> Modul (modules)                        [has a Modul-Kennnummer, LP]
--               -> Prüfungsleistung (exams)           [Klausur, Hausarbeit, ...]
--
-- Leistungspunkte (LP) are JGU's term for ECTS credits (~30h workload each).
-- A module's grade (Modulnote) is on the German 1.0 (best) - 5.0 (fail)
-- scale, same as individual exam grades.
--
-- This file is safe to run more than once (CREATE TABLE IF NOT EXISTS /
-- INSERT OR IGNORE throughout) — the server runs it on every startup, the
-- same way the files app makes sure its data directory exists.

PRAGMA foreign_keys = ON;

-- Semesters. JGU runs Wintersemester (Oct-Mar) and Sommersemester (Apr-Sep).
CREATE TABLE IF NOT EXISTS semesters (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    label       TEXT NOT NULL UNIQUE,             -- e.g. 'WiSe 2025/26', 'SoSe 2026'
    term        TEXT NOT NULL CHECK (term IN ('WiSe', 'SoSe')),
    start_year  INTEGER NOT NULL,
    sort_order  INTEGER NOT NULL                  -- chronological ordering key
);

-- A degree program, e.g. "Informatik B.Sc." under a given Prüfungsordnung.
CREATE TABLE IF NOT EXISTS study_programs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    degree       TEXT NOT NULL CHECK (degree IN ('Bachelor', 'Master', 'Staatsexamen', 'Sonstiges')),
    po_version   TEXT,                            -- e.g. 'PO 2021'
    lp_required  INTEGER NOT NULL,                -- total LP needed to finish the program
    is_primary   INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1))
);

-- Prüfungsordnungsbereich: the sections a Studiengang is split into for LP
-- accounting purposes (JOGU-StINe sums LP per PO-Bereich). Common examples:
-- Kernfach, Beifach, Optionalbereich, Schlüsselqualifikationen.
CREATE TABLE IF NOT EXISTS po_areas (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    study_program_id  INTEGER NOT NULL REFERENCES study_programs(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    lp_required       INTEGER,
    UNIQUE (study_program_id, name)
);

-- A Modul, identified by its Modul-Kennnummer in JOGU-StINe.
CREATE TABLE IF NOT EXISTS modules (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    study_program_id       INTEGER NOT NULL REFERENCES study_programs(id) ON DELETE CASCADE,
    po_area_id             INTEGER REFERENCES po_areas(id) ON DELETE SET NULL,
    module_code            TEXT,                  -- Modul-Kennnummer, e.g. 'B.Inf.1101'
    title                  TEXT NOT NULL,
    lp                     REAL NOT NULL,          -- Leistungspunkte (some modules award half-LP)
    module_kind            TEXT NOT NULL DEFAULT 'Pflicht'
                                CHECK (module_kind IN ('Pflicht', 'Wahlpflicht', 'Wahl')),
    recommended_semester   INTEGER,                -- Regelsemester laut Studienverlaufsplan
    status                 TEXT NOT NULL DEFAULT 'geplant'
                                CHECK (status IN (
                                    'geplant',        -- will take
                                    'angemeldet',      -- registered, hasn't started
                                    'laufend',         -- in progress / took, awaiting result
                                    'bestanden',       -- passed
                                    'nicht_bestanden', -- failed (out of attempts)
                                    'abgebrochen'      -- withdrawn
                                )),
    planned_semester_id    INTEGER REFERENCES semesters(id) ON DELETE SET NULL,
    completed_semester_id  INTEGER REFERENCES semesters(id) ON DELETE SET NULL,
    final_grade            REAL,                   -- Modulnote 1.0-5.0, NULL until finished
    module_coordinator     TEXT,                   -- Modulverantwortliche(r), optional
    notes                  TEXT,
    created_at             TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A Prüfungsleistung (or Studienleistung) belonging to a module — a module
-- is often made up of more than one of these (e.g. Klausur + Referat).
CREATE TABLE IF NOT EXISTS exams (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id        INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    semester_id      INTEGER NOT NULL REFERENCES semesters(id) ON DELETE RESTRICT,
    exam_type        TEXT NOT NULL CHECK (exam_type IN (
                          'Klausur', 'Hausarbeit', 'Muendliche_Pruefung', 'Portfolio',
                          'Projektbericht', 'Referat', 'Abschlussarbeit', 'Sonstige'
                      )),
    attempt_number   INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number BETWEEN 1 AND 3),
                          -- Erstversuch = 1; JGU allows at most 2 Wiederholungsversuche
    exam_date        TEXT,                        -- ISO date, NULL if not yet scheduled
    registered       INTEGER NOT NULL DEFAULT 0 CHECK (registered IN (0, 1)),
                          -- Prüfungsanmeldung über JOGU-StINe erfolgt?
    grade            REAL,                        -- Note 1.0-5.0, NULL until published
    passed           INTEGER CHECK (passed IN (0, 1)),  -- NULL = ausstehend
    weight_percent   REAL,                         -- Gewichtung an der Modulnote, if applicable
    notes            TEXT
);

CREATE INDEX IF NOT EXISTS idx_modules_study_program ON modules(study_program_id);
CREATE INDEX IF NOT EXISTS idx_modules_status ON modules(status);
CREATE INDEX IF NOT EXISTS idx_exams_module ON exams(module_id);
CREATE INDEX IF NOT EXISTS idx_exams_semester ON exams(semester_id);

-- Per-program progress: LP earned so far and the LP-weighted average grade
-- across completed modules (the same weighting JGU uses for a Gesamtnote).
CREATE VIEW IF NOT EXISTS v_progress_summary AS
SELECT
    sp.id AS study_program_id,
    sp.name AS study_program_name,
    sp.lp_required,
    COALESCE(SUM(CASE WHEN m.status = 'bestanden' THEN m.lp ELSE 0 END), 0) AS lp_earned,
    ROUND(
        SUM(CASE WHEN m.status = 'bestanden' AND m.final_grade IS NOT NULL THEN m.final_grade * m.lp ELSE 0 END)
        / NULLIF(SUM(CASE WHEN m.status = 'bestanden' AND m.final_grade IS NOT NULL THEN m.lp ELSE 0 END), 0),
        2
    ) AS lp_weighted_average_grade
FROM study_programs sp
LEFT JOIN modules m ON m.study_program_id = sp.id
GROUP BY sp.id;

-- A handful of starter semesters so the dropdowns aren't empty on first run.
-- Add more the same way as your studies go on — either here or via the API.
INSERT OR IGNORE INTO semesters (label, term, start_year, sort_order) VALUES
    ('WiSe 2024/25', 'WiSe', 2024, 1),
    ('SoSe 2025',    'SoSe', 2025, 2),
    ('WiSe 2025/26', 'WiSe', 2025, 3),
    ('SoSe 2026',    'SoSe', 2026, 4);
