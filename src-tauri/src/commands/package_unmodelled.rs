//! Fields of a package on disk that this build does not model.
//!
//! The package editor reads every entity into this build's definition types and
//! writes them back from those types, so a field the build does not know is
//! dropped on save. A package rebuilt by newer tooling (new attributes, new
//! competition settings) would lose that data the first time an older app's
//! editor saved it — which happened on 2026-10-16, when an app built before the
//! 26-attribute split erased seven attributes from every player.
//!
//! Before a save these fields are read off the files still on disk, per entity,
//! and grafted back onto what the editor writes. A field is unmodelled when a
//! round trip through the definition type loses it, so a modelled field the
//! author cleared stays cleared.
//!
//! An entity this build cannot read at all (a competition format added later,
//! say) never reached the editor, so the author cannot have deleted it: it is
//! written back as it was rather than dropped with its file.

use ofm_core::generator::{
    load_definition_file, CompetitionDefinition, ConfederationDef, CountryDef, NamesDefinition,
    PlayerDef, StaffDef, TeamDef, WorldMetaDef,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

/// The unmodelled fields of one package directory, keyed by schema and id.
#[derive(Default)]
pub(crate) struct UnmodelledFields {
    entities: HashMap<(String, String), Value>,
    unreadable: HashMap<String, Vec<Value>>,
    world: Option<Value>,
    names: Option<Value>,
}

impl UnmodelledFields {
    /// Read the unmodelled fields of every entity file under `pkg_dir`. Files
    /// that do not parse are skipped: they loaded as nothing, so nothing of
    /// theirs reaches the save to be grafted onto.
    pub(crate) fn read(pkg_dir: &Path) -> Self {
        let mut fields = Self::default();
        let mut files = Vec::new();
        collect_json_files(pkg_dir, &mut files);
        for path in files {
            let Some(document) = load_definition_file::<Value>(&path) else {
                continue;
            };
            fields.add_document(document);
        }
        fields
    }

    fn add_document(&mut self, document: Value) {
        let Some(schema) = document
            .get("schema")
            .and_then(Value::as_str)
            .map(str::to_string)
        else {
            return;
        };
        match schema.as_str() {
            "world" => self.world = unmodelled_world(document),
            "names" => self.names = unmodelled_names(document),
            _ => match document.get("items").and_then(Value::as_array) {
                Some(items) => {
                    for item in items {
                        self.add_entity(&schema, item.clone());
                    }
                }
                // A one-entity file, such as a competition per file: the entity
                // is the document, less the file's schema tag.
                None => {
                    let mut entity = document;
                    if let Some(object) = entity.as_object_mut() {
                        object.remove("schema");
                    }
                    self.add_entity(&schema, entity);
                }
            },
        }
    }

    fn add_entity(&mut self, schema: &str, entity: Value) {
        let Some(id) = entity.get("id").and_then(Value::as_str).map(str::to_string) else {
            return;
        };
        let modelled = match schema {
            "confederation" => round_trip::<ConfederationDef>(&entity),
            "country" => round_trip::<CountryDef>(&entity),
            "team" => round_trip::<TeamDef>(&entity),
            "player" => round_trip::<PlayerDef>(&entity),
            "staff" => round_trip::<StaffDef>(&entity),
            "competition" => round_trip::<CompetitionDefinition>(&entity),
            // A schema this build does not save is left on disk untouched.
            _ => return,
        };
        match modelled {
            Some(modelled) => {
                if let Some(extra) = subtract(&entity, &modelled) {
                    self.entities.insert((schema.to_string(), id), extra);
                }
            }
            None => self
                .unreadable
                .entry(schema.to_string())
                .or_default()
                .push(entity),
        }
    }

    /// Put back the unmodelled fields of each entity in `items`, a saved
    /// collection of `schema`, and the entities of `schema` this build could
    /// not read. One the editor has since created under the same id wins.
    pub(crate) fn restore_items(&self, schema: &str, items: &mut Vec<Value>) {
        for item in items.iter_mut() {
            let Some(id) = item.get("id").and_then(Value::as_str) else {
                continue;
            };
            if let Some(extra) = self.entities.get(&(schema.to_string(), id.to_string())) {
                graft(item, extra);
            }
        }
        let saved_ids: HashSet<String> = items
            .iter()
            .filter_map(|item| item.get("id").and_then(Value::as_str).map(str::to_string))
            .collect();
        for entity in self.unreadable.get(schema).into_iter().flatten() {
            let id = entity.get("id").and_then(Value::as_str).unwrap_or_default();
            if !saved_ids.contains(id) {
                items.push(entity.clone());
            }
        }
    }

    pub(crate) fn restore_world(&self, manifest: &mut Value) {
        if let Some(extra) = &self.world {
            graft(manifest, extra);
        }
    }

    pub(crate) fn restore_names(&self, names: &mut Value) {
        if let Some(extra) = &self.names {
            graft(names, extra);
        }
    }
}

fn collect_json_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_json_files(&path, out);
        } else if matches!(
            path.extension().and_then(|ext| ext.to_str()),
            Some("json" | "yaml" | "yml")
        ) {
            out.push(path);
        }
    }
}

fn unmodelled_world(document: Value) -> Option<Value> {
    let meta: WorldMetaDef = serde_json::from_value(document.clone()).ok()?;
    let modelled = ofm_core::generator::manifest_json(&meta).ok()?;
    subtract(&document, &modelled)
}

fn unmodelled_names(document: Value) -> Option<Value> {
    let names: NamesDefinition = serde_json::from_value(document.clone()).ok()?;
    let modelled = ofm_core::generator::names_json(&names).ok()?;
    subtract(&document, &modelled)
}

/// `entity` as this build writes it back: the fields it models.
fn round_trip<T: DeserializeOwned + Serialize>(entity: &Value) -> Option<Value> {
    let typed: T = serde_json::from_value(entity.clone()).ok()?;
    serde_json::to_value(typed).ok()
}

/// The parts of `original` that `modelled` lacks: keys it does not have, and
/// within objects both have, their own missing keys. Arrays are compared whole
/// and never split, so an unmodelled field inside a list element is not kept.
fn subtract(original: &Value, modelled: &Value) -> Option<Value> {
    let (Value::Object(original), Value::Object(modelled)) = (original, modelled) else {
        return None;
    };
    let mut extra = Map::new();
    for (key, value) in original {
        match modelled.get(key) {
            None => {
                extra.insert(key.clone(), value.clone());
            }
            Some(kept) => {
                if let Some(inner) = subtract(value, kept) {
                    extra.insert(key.clone(), inner);
                }
            }
        }
    }
    (!extra.is_empty()).then_some(Value::Object(extra))
}

/// Add `extra`'s keys to `target` where `target` has none of its own; where
/// both are objects, recurse. What the editor wrote always wins.
fn graft(target: &mut Value, extra: &Value) {
    let (Value::Object(target), Value::Object(extra)) = (target, extra) else {
        return;
    };
    for (key, value) in extra {
        match target.get_mut(key) {
            None => {
                target.insert(key.clone(), value.clone());
            }
            Some(existing) => graft(existing, value),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Given an entity with a field the type drops, when it is subtracted from
    /// its round trip, then only that field remains, nested ones included.
    #[test]
    fn the_fields_a_round_trip_loses_are_the_unmodelled_ones() {
        let original =
            json!({"id": "a", "name": "A", "attributes": {"pace": 80, "curve": 70}, "mood": 1});
        let modelled = json!({"id": "a", "name": "B", "attributes": {"pace": 90}});

        assert_eq!(
            subtract(&original, &modelled),
            Some(json!({"attributes": {"curve": 70}, "mood": 1}))
        );
        assert_eq!(subtract(&modelled, &modelled), None);
    }

    /// Given a saved entity and its unmodelled fields, when they are grafted
    /// on, then the missing fields return and the saved values are untouched.
    #[test]
    fn grafting_never_overwrites_what_the_editor_wrote() {
        let mut saved = json!({"id": "a", "attributes": {"pace": 91}, "mood": 2});
        graft(
            &mut saved,
            &json!({"attributes": {"curve": 70, "pace": 10}, "mood": 1, "kit": "red"}),
        );

        assert_eq!(
            saved,
            json!({"id": "a", "attributes": {"pace": 91, "curve": 70}, "mood": 2, "kit": "red"})
        );
    }
}
