(function () {

    var plugins = [
        'https://vaservaga.github.io/lampa-plugins/plugins/tmdb_proxy/tmdb_proxy.js',
        'https://vaservaga.github.io/lampa-plugins/plugins/online/online.js',
        'https://vaservaga.github.io/lampa-plugins/plugins/collections/collections.js',
        'https://vaservaga.github.io/lampa-plugins/plugins/tracks/tracks.js'
    ];

    plugins.forEach(function(url) {
        var script = document.createElement('script');
        script.src = url;
        script.async = false;
        document.head.appendChild(script);
    });

})();
