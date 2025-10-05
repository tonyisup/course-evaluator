from playwright.sync_api import sync_playwright, expect

def run_verification():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        try:
            # Navigate to the running application
            page.goto("http://localhost:5173/")

            # Take an initial screenshot for debugging
            page.screenshot(path="jules-scratch/verification/initial_view.png")

            # Wait for the main heading to be visible
            expect(page.get_by_role("heading", name="Evaluate Course Equivalency")).to_be_visible(timeout=10000)

            # Switch to the "Advanced" tab
            advanced_tab = page.get_by_role("button", name="Advanced")
            expect(advanced_tab).to_be_visible()
            advanced_tab.click()

            # Verify that the advanced mode components are visible
            expect(page.get_by_role("heading", name="External Courses")).to_be_visible()
            expect(page.get_by_role("heading", name="Internal Courses")).to_be_visible()

            # Take a screenshot
            page.screenshot(path="jules-scratch/verification/verification.png")

            print("Frontend verification script ran successfully.")

        except Exception as e:
            print(f"An error occurred during verification: {e}")
            # Take a screenshot on failure
            page.screenshot(path="jules-scratch/verification/failure.png")

        finally:
            browser.close()

if __name__ == "__main__":
    run_verification()