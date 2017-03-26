import React from 'react'
import { Menu } from 'semantic-ui-react'

const Nav = () =>
  <nav style={{ padding: '10px 10px 0 10px' }}>
    <Menu>
      <Menu.Item href="/#/">Home</Menu.Item>
      <Menu.Menu position="right">
        <Menu.Item onClick>Sign In</Menu.Item>
      </Menu.Menu>
    </Menu>
  </nav>

export default Nav
