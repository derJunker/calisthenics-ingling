import { Application } from "@hotwired/stimulus"

import CalendarController from "./controllers/calendar_controller";

window.Stimulus = Application.start()
Stimulus.register("calendar", CalendarController)