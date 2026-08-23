import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
    async connect() {
        await fetch("/api/weather.php").then(async res => {
            await res.json()
        })
    }
}