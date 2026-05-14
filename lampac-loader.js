```javascript
(function () {

    var plugins = [
        'https://vaservaga.github.io/lampa-plugins/plugins/tracks/tracks.js'
    ];

    plugins.forEach(function(url) {
        var script = document.createElement('script');
        script.src = url;
        script.async = false;
        document.head.appendChild(script);
    });

})();
```
