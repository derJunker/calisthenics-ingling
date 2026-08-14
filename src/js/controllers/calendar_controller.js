import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
    async connect() {
        console.log("connected", this.element)
        const weather = await (await fetch("/public/api/weather.php")).json()
        console.log("weather", weather)
    }
}