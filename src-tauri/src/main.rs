// Desktop shell entry. In release Windows builds this is a GUI-subsystem binary (no console).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    cognate_workbench_shell::run()
}
