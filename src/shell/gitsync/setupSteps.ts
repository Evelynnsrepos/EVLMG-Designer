/**
 * Git sync setup for people who never used Git (0.19). Shown in the Git sync window and the user guide.
 * Web addresses in these lines become clickable; keep punctuation away from them.
 */

export const GIT_SETUP_STEPS = [
  'Install Git (free). Windows and Mac: download it from https://git-scm.com/downloads and click through the installer, the default choices are fine. Linux: install the package called git from your software store or package manager.',
  'Make a free GitHub account at https://github.com/signup (skip this if you have one).',
  'Log Git in to GitHub, once per computer. On Windows you can skip this step: Git for Windows signs you in by itself, with a GitHub sign-in window the first time you turn on Git sync. On Mac and Linux: install GitHub CLI from https://cli.github.com then open a terminal (Windows: Terminal or PowerShell, Mac: Terminal) and type "gh auth login" and press Enter. Choose GitHub.com, then HTTPS, answer Yes to "Authenticate Git with your GitHub credentials", then Login with a web browser. Your browser opens; type in the code the terminal shows.',
  'Make an empty, private repository: open https://github.com/new and type a name, for example my-game-save. Choose Private. Leave "Add a README" off. Click Create repository.',
  'Copy its address: on the new repository\'s page, under Quick setup, click the copy button next to the HTTPS address. It ends in .git',
  'Back in Evelopment Games Designer: open your project, click Git sync in the sidebar, paste the address, tick I understand and click Turn on. That\'s it.',
  'On your other computer: do steps 1 and 3 there too, then click Open from Git on the start screen and paste the same address.',
]

export const GIT_LEARN_LINKS = [
  'What Git and GitHub are, in plain words: https://docs.github.com/en/get-started/start-your-journey/about-github-and-git',
  'Making a repository on GitHub, with pictures: https://docs.github.com/en/repositories/creating-and-managing-repositories/quickstart-for-repositories',
  'Logging in with GitHub CLI: https://cli.github.com/manual/gh_auth_login',
  'The free Pro Git book, if you want to know more: https://git-scm.com/book/en/v2',
  'On Windows and Mac, GitHub Desktop (https://desktop.github.com) is an easy way to look at your repository and its history. It has its own login, so it does not replace step 3.',
  'Other Git hosts work too, like GitLab or Codeberg: make an empty private repository there and use its HTTPS address. Logging in works differently there; their help pages explain how.',
]
