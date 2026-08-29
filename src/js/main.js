import { Application } from "@hotwired/stimulus"

import './section-scroll-animation'
import './section-scroll-pilot'

import BackgroundController from "./controllers/background_controller";
import CalendarController from "./controllers/calendar_controller";
import NavController from "./controllers/nav_controller";

window.Stimulus = Application.start()
Stimulus.register("background", BackgroundController)
Stimulus.register("calendar", CalendarController)
Stimulus.register("nav", NavController)
