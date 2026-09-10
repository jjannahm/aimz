// Initialize Firebase
const firebaseConfig = {
    apiKey: 'AIzaSyBNDg2FEp6z2NyeOhnyhZlHjq8bD6g7Dpk',
    authDomain: 'aimzegypt-73b85.firebaseapp.com',
    databaseURL: 'https://aimzegypt-73b85-default-rtdb.firebaseio.com',
    projectId: 'aimzegypt-73b85',
    storageBucket: 'aimzegypt-73b85.appspot.com',
    messagingSenderId: '656885720338',
    appId: '1:656885720338:web:b4317ab76fb99c12ab7fcb',
    measurementId: 'G-8Y271SNM6X',
}

firebase.initializeApp(firebaseConfig)
let branch = ''

const teams = {
    'gardenia': [
        "Hammers",
        "Jaguars",
        "Dolphins",
        "Senzo 2013",
        "Palm Hills 2013"
    ],
    '30-june': [
        "Sharks",
        "Cheetahs",
        "Ideal 2011",
        "Palm Hills 2011",
        "Senzo 2011",
        "Senzo 2007 + 2009",
        "Palm Hills 2007",
        "Senzo 1st"
    ],
    'palm-hills-club': [
        "Ideal 2013 (2 teams)",
        "Kafr saad",
        "Batal 2011",
        "Maroons U12",
        "Bunnies U10",
        "Butterflies U8"
    ],
    'kings-school': [
        "2015 team",
        "Wolves (were Bats last year)",
        "2009 team",
        "United",
        "Ideal 2011",
        "Kafr Saad 2011",
        "VFC 2011",
        "Batal 2013",
        "Batal 2009",
        "Batal 2007",
        "Batal First (3rd division)"
    ],
    // 'kent-college': [
    //     "Bank Ahly 2009",
    //     "Bank Ahly 2012"
    // ],
};

function selectBranch(id, num) {
    document.getElementById(
        'success-img',
    ).src = `assets/img/success.png`
    // ).src = `assets/img/success-${getInputVal(id)}.png`

    var checkBox = getInputVal(id)
    // If the checkbox is checked, display the output text
    if (checkBox.checked == true) {
    } else {
        branch = checkBox

        let n = document.getElementsByClassName('choice')
        for (const item of n) {
            item.classList.remove('active')
            $('#' + id).removeClass('active')
        }

        // parentDiv.classList.add("active");
        $('#' + id).addClass('active')
        console.log(branch)
    }

    const teamSelect = document.getElementById('teams');
    // Clear existing options
    teamSelect.innerHTML = '<option value="">Select a team</option>';

    if (teams[branch]) {
        // Add new options based on the selected branch
        teams[branch].forEach(team => {
            const option = document.createElement('option');
            option.value = team;
            option.textContent = team;
            teamSelect.appendChild(option);
        });
    }
}

// Reference messages collection
var messagesRef = firebase.database().ref('/kit')
// Listen for form submit

// Submit form
function submitForm() {
    var $valid = $('.wizard-card form').valid()
    if ($valid) {
        // // Get values
        let name = getInputVal('fullname')
        let Goalkeeper = getInputVal('Goalkeeper')
        let dateofbirth = getInputVal('dateOfBirth')
        let kitName = getInputVal('Name')
        let kitNum = getInputVal('Num')
        let kitsize = getInputVal('kitsize')
        let hoodiesize = getInputVal('hoodiesize')
        let team = getInputVal('teams')
        let outwearsize = getInputVal('outwearsize')
        let receive_kit_by = getInputVal('receive_kit_by')

        // let you = document.querySelector('input[name="radio"]:checked').value;

        if (!isNaN(kitNum)) {
            // Save message
            saveMessage(name, Goalkeeper, dateofbirth, kitName, kitNum, kitsize, hoodiesize, team, outwearsize, receive_kit_by)

            // Clear form
            $('#wizardProfile').hide()
            // $("#wizardProfile").show();
            $('#divs').css('display', 'block')
        } else {
            document.getElementById('Num').value = ''
        }
    } else {
        $validator.focusInvalid()
    }
}

// Function to get form values
function getInputVal(id) {
    return document.getElementById(id).value
}

// Save message to firebase
function saveMessage(name, Goalkeeper, dateofbirth, kitName, kitNum, kitsize, hoodiesize, team, outwearsize, receive_kit_by) {
    let newMessageRef = messagesRef.push()

    newMessageRef
        .set({
            branch: branch,
            team: team,
            name: name,
            Goalkeeper: Goalkeeper,
            dateofbirth: dateofbirth,
            kitName: kitName,
            kitNum: kitNum,
            kitsize: kitsize,
            outwearsize: outwearsize,
            receive_kit_by: receive_kit_by,
            hoodiesize: hoodiesize,
            created_at: firebase.database.ServerValue.TIMESTAMP,
        })
        .then(
            (cityData) => {
                console.log(cityData)
            },
            (err) => console.log(err),
            () => console.log('Complete!'),
        )
}
