//! Where a package project keeps each entity, so the editor's save can write
//! every entity back to the file it came from, in the shape it had there.
//!
//! A package may keep one file per entity type, as a scaffolded project does,
//! or split them — a generated real-world package has one player file per club,
//! one team file per league and one file per competition. Its build and
//! authoring tools find clubs and leagues by those file names. A save that
//! folded everything into one file per type broke them, reordered every key,
//! and wrote empty fields (`"logo": null`) into every entity, so one edited
//! player showed up as a change to every file of the package.

use serde::de::{Deserializer, MapAccess, SeqAccess, Visitor};
use serde::ser::{SerializeMap, SerializeSeq, Serializer};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// A JSON value that keeps its object keys in the order they were written.
/// `serde_json::Value` sorts them, which would reorder every file a save touches.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Node {
    Leaf(Value),
    Object(Vec<(String, Node)>),
    Array(Vec<Node>),
}

impl Node {
    fn from_value(value: Value) -> Self {
        match value {
            Value::Object(fields) => Node::Object(
                fields
                    .into_iter()
                    .map(|(k, v)| (k, Node::from_value(v)))
                    .collect(),
            ),
            Value::Array(items) => Node::Array(items.into_iter().map(Node::from_value).collect()),
            leaf => Node::Leaf(leaf),
        }
    }

    fn get(&self, key: &str) -> Option<&Node> {
        match self {
            Node::Object(fields) => fields.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            Node::Leaf(_) | Node::Array(_) => None,
        }
    }

    fn as_str(&self) -> Option<&str> {
        match self {
            Node::Leaf(Value::String(s)) => Some(s),
            _ => None,
        }
    }

    /// `null`, `""`, `[]` or `{}`: what the editor sends for a field nobody set.
    fn is_empty(&self) -> bool {
        match self {
            Node::Leaf(value) => is_empty_value(value),
            Node::Object(fields) => fields.is_empty(),
            Node::Array(items) => items.is_empty(),
        }
    }
}

fn is_empty_value(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::String(s) => s.is_empty(),
        Value::Array(a) => a.is_empty(),
        Value::Object(o) => o.is_empty(),
        Value::Bool(_) | Value::Number(_) => false,
    }
}

impl serde::Serialize for Node {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Node::Leaf(value) => value.serialize(serializer),
            Node::Object(fields) => {
                let mut map = serializer.serialize_map(Some(fields.len()))?;
                for (key, value) in fields {
                    map.serialize_entry(key, value)?;
                }
                map.end()
            }
            Node::Array(items) => {
                let mut seq = serializer.serialize_seq(Some(items.len()))?;
                for item in items {
                    seq.serialize_element(item)?;
                }
                seq.end()
            }
        }
    }
}

struct NodeVisitor;

impl<'de> Visitor<'de> for NodeVisitor {
    type Value = Node;

    fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
        formatter.write_str("a JSON value")
    }
    fn visit_bool<E>(self, v: bool) -> Result<Node, E> {
        Ok(Node::Leaf(Value::Bool(v)))
    }
    fn visit_i64<E>(self, v: i64) -> Result<Node, E> {
        Ok(Node::Leaf(Value::from(v)))
    }
    fn visit_u64<E>(self, v: u64) -> Result<Node, E> {
        Ok(Node::Leaf(Value::from(v)))
    }
    fn visit_f64<E>(self, v: f64) -> Result<Node, E> {
        Ok(Node::Leaf(Value::from(v)))
    }
    fn visit_str<E>(self, v: &str) -> Result<Node, E> {
        Ok(Node::Leaf(Value::String(v.to_string())))
    }
    fn visit_unit<E>(self) -> Result<Node, E> {
        Ok(Node::Leaf(Value::Null))
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Node, A::Error> {
        let mut items = Vec::new();
        while let Some(item) = seq.next_element()? {
            items.push(item);
        }
        Ok(Node::Array(items))
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Node, A::Error> {
        let mut fields = Vec::new();
        while let Some((key, value)) = map.next_entry::<String, Node>()? {
            fields.push((key, value));
        }
        Ok(Node::Object(fields))
    }
}

impl<'de> serde::Deserialize<'de> for Node {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(NodeVisitor)
    }
}

/// One definition file of a saved schema, as it was on disk before the save.
struct SourceFile {
    path: PathBuf,
    schema: String,
    /// The whole file was one entity (`{"schema": …, "id": …}`), not an `items` list.
    single: bool,
    /// The file's top-level keys besides `items`, in order, kept on rewrite.
    header: Vec<(String, Node)>,
    entities: Vec<Node>,
}

/// The definition files a project holds, read before the save rewrites them.
pub(crate) struct ProjectLayout {
    files: Vec<SourceFile>,
}

/// What a save writes for one schema: file bodies, and files left with nothing.
pub(crate) struct SchemaWrite {
    pub writes: Vec<(PathBuf, Node)>,
    pub emptied: Vec<PathBuf>,
}

impl ProjectLayout {
    /// Read every definition file under `pkg_dir` whose schema is in `schemas`.
    /// Files that do not parse, or carry another schema (translations), are not
    /// the save's to touch and are left out.
    pub(crate) fn scan(pkg_dir: &Path, schemas: &[&str]) -> Self {
        let mut paths = Vec::new();
        super::package_editor::collect_definition_files(pkg_dir, &mut paths);
        paths.sort();
        let files = paths
            .into_iter()
            .filter_map(|path| {
                let text = std::fs::read_to_string(&path).ok()?;
                // JSON keeps its key order; YAML is read the way the loader reads it.
                let node = serde_json::from_str::<Node>(&text).ok().or_else(|| {
                    ofm_core::generator::parse_definition_str::<Value>(&text)
                        .ok()
                        .map(Node::from_value)
                })?;
                let schema = node.get("schema")?.as_str()?.to_string();
                schemas
                    .contains(&schema.as_str())
                    .then(|| source_file(path, schema, node))
            })
            .collect();
        Self { files }
    }

    /// Files of `schema` that are not `keep`. Used for the manifest and name
    /// pools, which a save writes as one file.
    pub(crate) fn other_files(&self, schema: &str, keep: &Path) -> Vec<PathBuf> {
        self.files
            .iter()
            .filter(|file| file.schema == schema && file.path != keep)
            .map(|file| file.path.clone())
            .collect()
    }

    /// The first file of `schema`, if the project has one.
    pub(crate) fn first_file(&self, schema: &str) -> Option<PathBuf> {
        self.files
            .iter()
            .find(|file| file.schema == schema)
            .map(|file| file.path.clone())
    }

    /// Lay `entities` of `schema` out over the files they came from.
    ///
    /// An entity already in a file goes back to that file, in the file's order.
    /// A new player goes to the file holding most of his club's players; any
    /// other new entity goes to `default_path`. A schema with no entities and no
    /// file writes nothing, so a package without staff gets no empty staff file.
    pub(crate) fn plan(
        &self,
        schema: &str,
        default_path: &Path,
        entities: Vec<Value>,
    ) -> SchemaWrite {
        let sources: Vec<&SourceFile> = self.files.iter().filter(|f| f.schema == schema).collect();
        let mut home: HashMap<&str, (usize, usize)> = HashMap::new();
        for (file_index, file) in sources.iter().enumerate() {
            for (position, entity) in file.entities.iter().enumerate() {
                if let Some(id) = entity.get("id").and_then(Node::as_str) {
                    home.entry(id).or_insert((file_index, position));
                }
            }
        }

        let mut placed: Vec<Vec<(usize, Node)>> = vec![Vec::new(); sources.len()];
        let mut fresh: Vec<Node> = Vec::new();
        for entity in entities {
            let id = entity.get("id").and_then(Value::as_str).unwrap_or_default();
            match home.get(id).copied() {
                Some((file_index, position)) => {
                    let original = &sources[file_index].entities[position];
                    placed[file_index].push((position, merge(entity, Some(original))));
                }
                None => match club_file(schema, &entity, &sources) {
                    Some(file_index) => placed[file_index].push((usize::MAX, merge(entity, None))),
                    None => fresh.push(merge(entity, None)),
                },
            }
        }

        let mut write = SchemaWrite {
            writes: Vec::new(),
            emptied: Vec::new(),
        };
        let default_index = sources.iter().position(|file| file.path == default_path);
        for (file_index, file) in sources.iter().enumerate() {
            let mut entities = std::mem::take(&mut placed[file_index]);
            // A stable sort keeps new entities (position MAX) in the editor's order.
            entities.sort_by_key(|(position, _)| *position);
            let mut entities: Vec<Node> = entities.into_iter().map(|(_, e)| e).collect();
            if Some(file_index) == default_index {
                entities.append(&mut fresh);
            }
            if entities.is_empty() && Some(file_index) != default_index {
                write.emptied.push(file.path.clone());
            } else {
                write
                    .writes
                    .push((file.path.clone(), file_body(file, schema, entities)));
            }
        }
        if default_index.is_none() && !fresh.is_empty() {
            write
                .writes
                .push((default_path.to_path_buf(), items_body(schema, &[], fresh)));
        }
        write
    }
}

fn source_file(path: PathBuf, schema: String, node: Node) -> SourceFile {
    let fields = match node {
        Node::Object(fields) => fields,
        Node::Leaf(_) | Node::Array(_) => Vec::new(),
    };
    let (items, header): (Vec<_>, Vec<_>) = fields.into_iter().partition(|(key, _)| key == "items");
    match items.into_iter().next() {
        Some((_, Node::Array(entities))) => SourceFile {
            path,
            schema,
            single: false,
            header,
            entities,
        },
        _ => {
            let entity: Vec<_> = header
                .into_iter()
                .filter(|(key, _)| key != "schema")
                .collect();
            let entities = if entity.is_empty() {
                Vec::new()
            } else {
                vec![Node::Object(entity)]
            };
            SourceFile {
                path,
                schema,
                single: true,
                header: Vec::new(),
                entities,
            }
        }
    }
}

/// The player file holding most of `entity`'s club, for a player new to the project.
fn club_file(schema: &str, entity: &Value, sources: &[&SourceFile]) -> Option<usize> {
    if schema != "player" {
        return None;
    }
    let club = entity
        .get("club")?
        .as_str()
        .filter(|club| !club.is_empty())?;
    sources
        .iter()
        .enumerate()
        .map(|(index, file)| {
            let mates = file
                .entities
                .iter()
                .filter(|other| other.get("club").and_then(Node::as_str) == Some(club))
                .count();
            (index, mates)
        })
        .filter(|(_, mates)| *mates > 0)
        .max_by_key(|(index, mates)| (*mates, std::cmp::Reverse(*index)))
        .map(|(index, _)| index)
}

/// Write `file`'s entities back in its own shape: one entity, or an `items` list.
fn file_body(file: &SourceFile, schema: &str, mut entities: Vec<Node>) -> Node {
    if file.single && entities.len() == 1 {
        let mut body = vec![(
            "schema".to_string(),
            Node::Leaf(Value::String(schema.to_string())),
        )];
        if let Some(Node::Object(fields)) = entities.pop() {
            body.extend(fields.into_iter().filter(|(key, _)| key != "schema"));
        }
        return Node::Object(body);
    }
    items_body(schema, &file.header, entities)
}

fn items_body(schema: &str, header: &[(String, Node)], entities: Vec<Node>) -> Node {
    let mut body = vec![(
        "schema".to_string(),
        Node::Leaf(Value::String(schema.to_string())),
    )];
    body.extend(header.iter().filter(|(key, _)| key != "schema").cloned());
    body.push(("items".to_string(), Node::Array(entities)));
    Node::Object(body)
}

/// `new` in the shape of the value it replaces: the original's keys in the
/// original's order, then any new ones, at every depth.
///
/// A key the original object did not have is left out when the editor sends it
/// empty: the loader already read that object without the key, so leaving it
/// out reads back the same default. A key the original had empty and the
/// editor's serializer skips (`"berths": []`) is kept. A brand-new object only
/// drops `null`, which every optional field reads as `None`.
fn merge(new: Value, original: Option<&Node>) -> Node {
    match (new, original) {
        (Value::Object(mut fields), Some(Node::Object(before))) => {
            let mut shaped = Vec::new();
            for (key, old) in before {
                match fields.remove(key) {
                    Some(value) => shaped.push((key.clone(), merge(value, Some(old)))),
                    None if old.is_empty() => shaped.push((key.clone(), old.clone())),
                    None => {}
                }
            }
            for (key, value) in fields {
                if !is_empty_value(&value) {
                    shaped.push((key, Node::from_value(value)));
                }
            }
            Node::Object(shaped)
        }
        (Value::Array(items), Some(Node::Array(before))) if items.len() == before.len() => {
            Node::Array(
                items
                    .into_iter()
                    .zip(before)
                    .map(|(value, old)| merge(value, Some(old)))
                    .collect(),
            )
        }
        (Value::Object(fields), None) => Node::Object(
            fields
                .into_iter()
                .filter(|(_, value)| !value.is_null())
                .map(|(key, value)| (key, Node::from_value(value)))
                .collect(),
        ),
        (value, _) => Node::from_value(value),
    }
}
