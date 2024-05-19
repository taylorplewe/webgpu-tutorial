package main

import (
	"fmt"
	"net/http"
	"strings"
)

func main() {
	http.HandleFunc("/", func(w http.ResponseWriter, req *http.Request) {
		path := strings.TrimPrefix(req.URL.Path, "/")
		if path == "" {
			http.ServeFile(w, req, "index.html")
		} else {
			http.ServeFile(w, req, path)
		}
	})

	fmt.Println("listening on port 80...")
	http.ListenAndServe(":80", nil)
}
