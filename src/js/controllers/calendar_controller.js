import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
    async connect() {
        console.log("connected", this.element)
        await fetch("/api/weather.php").then(async res => {
            console.log(await res.json())
        })
    }
}