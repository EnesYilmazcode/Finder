"""Small independent XLSX fixtures exercise the actual release importer."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from xml.sax.saxutils import escape
from zipfile import ZipFile

spec = importlib.util.spec_from_file_location("records", Path(__file__).resolve().parents[1] / "scripts/import-grade-records.py")
records = importlib.util.module_from_spec(spec)
spec.loader.exec_module(records)


class ImportTests(unittest.TestCase):
    def workbook(self, directory, rows):
        header = ["Campus", "Term Code", "Subject", "Catalog Number", "Class Number", "Instructor Name", "Total", *records.SCALE, "EN", "W", "S"]
        xml = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
        for i, row in enumerate([header, *rows], 1):
            xml += f'<row r="{i}">'
            for j, value in enumerate(row):
                # The test has fewer than 26 columns; real workbooks exercise AA+.
                xml += f'<c r="{chr(65+j)}{i}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>'
            xml += '</row>'
        xml += '</sheetData></worksheet>'
        path = Path(directory) / "record.xlsx"
        with ZipFile(path, "w") as z:
            z.writestr("xl/worksheets/sheet1.xml", xml)
        return path

    def row(self, name="Bucci,Paolo", campus="COL", a=7, en=2, w=1):
        return [campus, "1262", "CSE", "2221", "123", name, 10, a, *([""] * 10), en, w, ""]

    def test_blanks_en_campuses_duplicates_and_team_teaching(self):
        with tempfile.TemporaryDirectory() as directory:
            p = self.workbook(directory, [self.row(), self.row(), self.row("Smith,Ada"), self.row(campus="NWK")])
            snapshot, audit = records.build([p], min_instructors=2)
        self.assertEqual(audit["duplicateRows"], 1)
        self.assertEqual(audit["uniqueClasses"], 1)
        self.assertEqual(audit["coTaughtClasses"], 1)
        entry = snapshot["instructors"]["paolo bucci"]["courses"]["CSE 2221"]
        self.assertEqual(entry["counts"], [7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2])
        self.assertEqual(entry["sections"], 1)
        self.assertEqual(entry["coTaught"], 1)
        self.assertEqual(entry["other"], {"EN": 2, "W": 1})

    def test_bad_counts_fail_closed(self):
        for a in [6, -1, "*", "2.5"]:
            with self.subTest(a=a), tempfile.TemporaryDirectory() as directory:
                p = self.workbook(directory, [self.row(a=a)])
                with self.assertRaises(ValueError):
                    records.build([p], min_instructors=1)

    def test_conflicting_cohort_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            p = self.workbook(directory, [self.row(), self.row("Smith,Ada", a=6, en=3)])
            with self.assertRaisesRegex(ValueError, "conflicting"):
                records.build([p], min_instructors=1)


if __name__ == "__main__":
    unittest.main()
