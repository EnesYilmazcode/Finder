"""Import OSU's 2026-11-04 release directly from XLSX, using Python's stdlib.

Usage: python scripts/import-grade-records.py <directory of original workbooks>
No Excel installation, resaving, network access, or third-party packages needed.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
import unicodedata
import xml.etree.ElementTree as ET
from zipfile import ZipFile

NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
SCALE = ["A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "E"]
MARKS = ["No Grade", *SCALE, "EN", "I", "IX", "NG", "NEN", "NP", "P", "PA", "PE", "S", "U", "UEN", "W"]
REQUIRED = {"Campus", "Term Code", "Subject", "Catalog Number", "Class Number", "Instructor Name", "Total", *SCALE}


def sheet_rows(path):
    """Read sparse cells and both Excel shared-string and inline-string encodings."""
    with ZipFile(path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            shared = ["".join(si.itertext()) for si in root]
        sheets = [n for n in z.namelist() if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n)]
        if len(sheets) != 1:
            raise ValueError(f"{path.name}: expected exactly one worksheet")
        root = ET.fromstring(z.read(sheets[0]))
        for row in root.findall("s:sheetData/s:row", NS):
            cells = {}
            for c in row.findall("s:c", NS):
                col = 0
                for letter in re.match(r"[A-Z]+", c.attrib["r"])[0]:
                    col = col * 26 + ord(letter) - 64
                v = c.find("s:v", NS)
                value = v.text if v is not None else ""
                if c.attrib.get("t") == "s":
                    value = shared[int(value)]
                elif c.attrib.get("t") == "inlineStr":
                    value = "".join(t.text or "" for t in c.findall(".//s:t", NS))
                cells[col - 1] = value or ""
            if cells:
                yield [cells.get(i, "") for i in range(max(cells) + 1)]


def normal_name(value):
    parts = str(value).strip().split(",", 1)
    name = f"{parts[1].strip()} {parts[0].strip()}" if len(parts) == 2 else parts[0]
    key = re.sub(r"[^\w\s]", "", unicodedata.normalize("NFKC", name).lower())
    return name, " ".join(key.split())


def count(value):
    if value in (None, ""):
        return 0  # In this release only: redacted classes are omitted entirely.
    n = float(value)
    if not n.is_integer() or n < 0:
        raise ValueError(f"invalid grade count {value!r}")
    return int(n)


def empty():
    return {"counts": [0] * len(SCALE), "other": {}, "sections": 0, "enrolled": 0, "coTaught": 0}


def add(target, row):
    target["sections"] += 1
    target["enrolled"] += row["total"]
    target["coTaught"] += row["coTaught"]
    for i, n in enumerate(row["counts"]):
        target["counts"][i] += n
    for mark, n in row["other"].items():
        target["other"][mark] = target["other"].get(mark, 0) + n


def build(paths, min_instructors=200):
    rows, sources, seen, cohorts = [], [], {}, {}
    campuses = Counter()
    duplicates = 0
    for path in sorted(paths):
        it = iter(sheet_rows(path))
        header = next(it)
        while header and not header[-1]:
            header.pop()
        if len(header) != len(set(header)) or REQUIRED - set(header):
            raise ValueError(f"{path.name}: unexpected headers: {header}")
        if set(header) - REQUIRED - set(MARKS) - {"Term Description", "Subject Description", "Course Title"}:
            raise ValueError(f"{path.name}: unrecognized columns")
        file_rows, file_terms = 0, set()
        for line, cells in enumerate(it, 2):
            if any(cells[len(header):]):
                raise ValueError(f"{path.name}:{line}: data under an unnamed column")
            cells += [""] * (len(header) - len(cells))
            r = dict(zip(header, cells))
            if not any(r.values()):
                continue
            file_rows += 1
            campuses[r["Campus"]] += 1
            term = r["Term Code"].strip()
            if not re.fullmatch(r"1\d{2}[248]", term):
                raise ValueError(f"{path.name}:{line}: invalid term")
            file_terms.add(term)
            marks = {m: count(r.get(m)) for m in MARKS}
            total = count(r["Total"])
            if sum(marks.values()) != total or total < 10:
                raise ValueError(f"{path.name}:{line}: grade total does not reconcile or class is below release threshold")
            if r["Campus"] != "COL":
                continue
            name, key = normal_name(r["Instructor Name"])
            if not key or key in {"staff", "tba", "tbd", "unassigned"}:
                raise ValueError(f"{path.name}:{line}: missing instructor")
            code = f'{r["Subject"].strip().upper()} {r["Catalog Number"].strip().upper()}'
            if not re.fullmatch(r"\S+ [\w.]+", code) or not r["Class Number"].strip():
                raise ValueError(f"{path.name}:{line}: missing course or class identifier")
            cohort = (term, r["Campus"], r["Class Number"].strip())
            signature = (code, total, tuple(marks.values()))
            if cohort in cohorts and cohorts[cohort] != signature:
                raise ValueError(f"{path.name}:{line}: conflicting class distributions")
            cohorts[cohort] = signature
            identity = (*cohort, key)
            if identity in seen:
                if seen[identity] != signature:
                    raise ValueError(f"{path.name}:{line}: conflicting duplicate")
                duplicates += 1
                continue
            seen[identity] = signature
            counts = [marks[m] for m in SCALE]
            counts[-1] += marks["EN"]  # Faculty rule 3335-8-21(I): EN counts as E.
            # EN remains in the raw outcomes for disclosure, already included in E.
            other = {m: n for m, n in marks.items() if m not in SCALE and n}
            rows.append(dict(key=key, name=name, term=term, code=code, cohort=cohort,
                             counts=counts, other=other, total=total))
        if len(file_terms) != 1:
            raise ValueError(f"{path.name}: expected one term")
        sources.append(dict(file=path.name, sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                            rows=file_rows, term=next(iter(file_terms))))
    instructors = {}
    team = Counter(row["cohort"] for row in rows)
    person_terms = defaultdict(set)
    for row in rows:
        row["coTaught"] = int(team[row["cohort"]] > 1)
        person_terms[row["key"]].add(row["term"])
        person = instructors.setdefault(row["key"], {"name": row["name"], "courses": {}})
        entry = person["courses"].setdefault(row["code"], {**empty(), "history": {}})
        add(entry, row)
        add(entry["history"].setdefault(row["term"], empty()), row)
    for key, person in instructors.items():
        person["terms"] = len(person_terms[key])
        person["courses"] = dict(sorted(person["courses"].items()))
        for entry in person["courses"].values():
            entry["terms"] = len(entry["history"])
            entry["suppressed"] = 0  # Omitted classes are uncountable, never inferred.
            entry["history"] = dict(sorted(entry["history"].items()))
    if len(instructors) < min_instructors:
        raise ValueError(f"only {len(instructors)} instructors: refusing a partial import")
    terms = sorted({r["term"] for r in rows})
    snapshot = dict(source="The Ohio State University, public records request 27-0272",
                    released="2026-11-04", campus="columbus", firstTerm=terms[0], lastTerm=terms[-1],
                    termCount=len(terms), scale=SCALE, count=len(instructors), schemaVersion=2,
                    instructors=dict(sorted(instructors.items())))
    audit = dict(source=snapshot["source"], released=snapshot["released"], files=sources,
                 sourceRows=sum(campuses.values()), campuses=dict(campuses), duplicateRows=duplicates,
                 instructorClassRows=len(rows), uniqueClasses=len(cohorts),
                 coTaughtClasses=sum(n > 1 for n in team.values()), instructorNames=len(instructors),
                 terms=terms, gradeTotalsReconciled=True)
    return snapshot, audit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    paths = list(args.directory.glob("*.xlsx"))
    if not paths:
        parser.error("no XLSX workbooks found")
    snapshot, audit = build(paths)
    root = Path(__file__).resolve().parent.parent
    # Keep the global identity index (for ambiguity checks) small. Course history
    # is downloaded only for the subject whose detail pane the student opens.
    subjects = {}
    shards = {}
    for key, person in snapshot["instructors"].items():
        for code, entry in person["courses"].items():
            subject = code.split(" ", 1)[0]
            shards.setdefault(subject, {}).setdefault(key, {})[code] = entry
    outputs = []
    for subject, instructors in sorted(shards.items()):
        relative = f"data/grades/{subject}.json"
        subjects[subject] = f"grades/{subject}.json"
        outputs.append((relative, {"subject": subject, "instructors": instructors}))
    snapshot["subjects"] = subjects
    snapshot["instructors"] = {k: {"name": p["name"], "terms": p["terms"], "courses": {}}
                               for k, p in snapshot["instructors"].items()}
    outputs.extend([("data/grades.json", snapshot), ("data/grades-provenance.json", audit)])
    for relative, value in outputs:
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        tmp.replace(target)
    print(json.dumps({k: v for k, v in audit.items() if k != "files"}, indent=2))


if __name__ == "__main__":
    main()
