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

$(function() {
    let tabs = $('#tabs');
    tabs.tabs();
    tabs.tabs({
        beforeActivate: function(event, ui) {
            console.log('Before activate: ' + ui.newTab.index());
            let tree = $('#tree-' + ui.newTab.data('nodeid'));
            if (tree.data('populated') === 0) {
                tree.jstree({
                    'core': {
                        'data': function(node, cb) {
                            let url = node.id === '#' ? '/node/?nodeid=' + ui.newTab.data('nodeid') : '/node/?nodeid=' + node.id;
                            $.ajax({
                                url: url,
                                type: 'GET',
                                success: function(data) {
                                    console.log(data);
                                    cb(data);
                                },
                                error: function(_jqXHR, _textStatus, errorThrown) {
                                    console.log('Error: ' + errorThrown);
                                }
                            });
                        }
                    }
                });
                tree.data('populated', 1);
            }
        }
    });

    // $.ajax({
    //     url: '/node/?nodeid=0',
    //     type: 'GET',
    //     success: function (data) {
    //         console.log(data);
    //         let tabList = $('#tablist');
    //         for (var i = 0; i < data.length; i++) {
    //             tabList.append(`<li data-nodeid="${data[i].nodeId}"><a href="#tabs-${data[i].nodeId}">${data[i].name}</a></li>`);
    //             tabList.parent().append(`<div class="container" id="tabs-${data[i].nodeId}"><div class="box" data-populated="0" id="tree-${data[i].nodeId}"></div><div class="box">content</div></div>`);
    //         }
    //         tabs.tabs('refresh'); 
    //         tabs.tabs('option', 'active', 0);
    //     },
    //     error: function (_jqXHR, _textStatus, errorThrown) {
    //         console.log('Error: ' + errorThrown);
    //     }
    // });

    $('#artistsTree').jstree({
        'core': {
            'data': function (node, cb) {
                if (node.id === '#') {
                    $.ajax({
                        url: '/node/?nodeid=0',
                        type: 'GET',
                        success: function(data) {
                            console.log(data);
                            cb(data.map((artist) => {
                                return { 'text': artist.name, 'id': artist.id, 'children': true };
                            }));
                        },
                        error: function(_jqXHR, _textStatus, errorThrown) {
                            console.log('Error: ' + errorThrown);
                        }
                    });
                    // cb([
                    //     { 'text': 'Artist1', 'id': 93, 'children': true },
                    //     { 'text': 'Artist2', 'id': 94, 'children': true },
                    //     { 'text': 'Artist3', 'id': 95, 'children': true }
                    // ]);
                } 
                else {
                    cb([{ 'text': 'album1', 'id': 1003, 'children': false }]);
                }
                return { 'id': node.id };
            }
        }
    });
})