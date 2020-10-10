---
layout: blocks
title: Contact
date: 
page_sections:
- template: navigation-header-w-button
  block: header-2
  navigation:
  - link: "/"
    link_text: Home
  - link: my-works
    link_text: My Works
  - link: "/about-me"
    link_text: About Me
  cta:
    url: "/contact"
    button_text: Contact
  logo: "/uploads/2020/10/05/icon_with_text.png"
- template: simple-form
  block: simple-form
  form:
    type: simple
    method: POST
    recipient: sangstar@gmail.com
    submit_text: Message Me
    action: https://smartforms.dev/submit/5f5f20a5b81854118fd3d6ad
    fields:
    - template: text
      block: text
      type: text
      name: Name
      label: Name
      description: ''
      required: 'True'
    - template: email
      type: email
      required: 'True'
      name: Email
      label: Email
      description: ''
    - template: textarea
      type: textarea
      name: Message
      label: Message
      description: ''
      required: 'True'
      rows: '4'
      cols: '50'
  title: Message Me
- template: simple-footer
  block: footer-1
  content: <a href="https://www.artstation.com/lokho" title="Artstation"><img src="/uploads/2020/10/10/artstationartboard-1-2x.png"></a>
    <a href="https://www.instagram.com/loksangho/" title="Instagram"><img src="/uploads/2020/10/10/instagramartboard-1-2x.png"></a>
    <a href="https://www.linkedin.com/in/loksangho/" title="LinkedIn"><img src="/uploads/2020/10/10/linkedinartboard-1-2x.png"></a>
    <a href="https://www.youtube.com/channel/UC1DHShERDsCziO9iertdIRg" title="Youtube"><img
    src="/uploads/2020/10/10/youtubeartboard-1-2x.png" title="Youtube"></a>

---
