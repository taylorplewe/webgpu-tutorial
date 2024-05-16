package main

import (
	"fmt"
	"net/http"
)

func main() {
	http.HandleFunc("/", func(w http.ResponseWriter, req *http.Request) {
		http.ServeFile(w, req, "index.html")
	})

	fmt.Println("listening on port 80...")
	http.ListenAndServe(":80", nil)
}
