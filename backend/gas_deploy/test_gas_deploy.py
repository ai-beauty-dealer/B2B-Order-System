import os
import tempfile
import unittest


import gas_deploy


class GasDeploySafetyTest(unittest.TestCase):
    def test_sheet_id_is_required(self):
        projects = [{
            "name": "社員A",
            "scriptId": "a" * 30,
            "deploymentId": "",
        }]

        with self.assertRaisesRegex(ValueError, "sheetId"):
            gas_deploy.validate_projects(projects)

    def test_duplicate_sheet_id_is_rejected(self):
        projects = [
            {
                "name": "社員A",
                "scriptId": "a" * 30,
                "sheetId": "s" * 30,
            },
            {
                "name": "社員B",
                "scriptId": "b" * 30,
                "sheetId": "s" * 30,
            },
        ]

        with self.assertRaisesRegex(ValueError, "sheetIdが重複"):
            gas_deploy.validate_projects(projects)

    def test_employee_sheet_id_is_injected_into_staged_code(self):
        sheet_id = "1EmployeeSheetIdForSafetyTest_12345"

        with tempfile.TemporaryDirectory() as directory:
            gas_deploy.stage_files(
                directory,
                ["code.gs"],
                sheet_id,
            )

            code_path = os.path.join(directory, "code.js")
            gas_deploy.validate_staged_sheet_id(
                code_path, sheet_id
            )

            with open(code_path, encoding="utf-8") as file:
                content = file.read()

            self.assertIn(sheet_id, content)
            self.assertNotIn(
                gas_deploy.SHEET_ID_PLACEHOLDER,
                content,
            )

    def test_duplicate_dealer_is_rejected(self):
        projects = [
            {
                "name": "社員A",
                "dealer": "761",
                "scriptId": "a" * 30,
                "sheetId": "s" * 30,
            },
            {
                "name": "社員B",
                "dealer": "761",
                "scriptId": "b" * 30,
                "sheetId": "t" * 30,
            },
        ]

        with self.assertRaisesRegex(ValueError, "dealerが重複"):
            gas_deploy.validate_projects(projects)

    def test_empty_dealer_rows_do_not_collide(self):
        projects = [
            {
                "name": "社員A",
                "scriptId": "a" * 30,
                "sheetId": "s" * 30,
            },
            {
                "name": "社員B",
                "scriptId": "b" * 30,
                "sheetId": "t" * 30,
            },
        ]

        self.assertEqual(
            len(gas_deploy.validate_projects(projects)), 2
        )

    def test_only_still_validates_whole_ledger(self):
        # --only対象外のレコード同士でsheetIdが重複していても
        # 台帳全体の検査で止まること（他社員シート誤配信の防止）
        projects = [
            {
                "name": "社員A",
                "scriptId": "a" * 30,
                "sheetId": "s" * 30,
            },
            {
                "name": "社員B",
                "scriptId": "b" * 30,
                "sheetId": "s" * 30,
            },
            {
                "name": "社員C",
                "scriptId": "c" * 30,
                "sheetId": "u" * 30,
            },
        ]

        with self.assertRaisesRegex(ValueError, "sheetIdが重複"):
            gas_deploy.select_projects(projects, "社員C")

    def test_only_selects_single_project(self):
        projects = [
            {
                "name": "社員A",
                "scriptId": "a" * 30,
                "sheetId": "s" * 30,
            },
            {
                "name": "社員B",
                "scriptId": "b" * 30,
                "sheetId": "t" * 30,
            },
        ]

        selected = gas_deploy.select_projects(projects, "社員B")
        self.assertEqual(
            [p["name"] for p in selected], ["社員B"]
        )

    def test_only_with_unknown_name_is_rejected(self):
        projects = [{
            "name": "社員A",
            "scriptId": "a" * 30,
            "sheetId": "s" * 30,
        }]

        with self.assertRaisesRegex(ValueError, "見つからない"):
            gas_deploy.select_projects(projects, "社員X")

    def test_dry_run_staging_validates_project_code(self):
        project = {
            "name": "社員A",
            "scriptId": "a" * 30,
            "sheetId": "1EmployeeSheetForDryRun_123456789",
        }

        gas_deploy.validate_project_staging(
            project,
            ["code.gs"],
        )


if __name__ == "__main__":
    unittest.main()
