function getAllArtists() {
    $.ajax({
        url: 'http://localhost:8080/music/artists',
        type: 'GET',
        success: function(data) {
            console.log(data);
            var artists = data.artists;
            for (var i = 0; i < artists.length; i++) {
                $('#artists').append('<li>' + artists[i].name + '</li>');
            }
        }
    });
}