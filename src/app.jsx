import React from 'react'
import { render } from 'react-dom'
import {
  HashRouter as Router,
  Route,
} from 'react-router-dom'

import './style.css'

import MainView from './components/MainView'
import Nav from './components/Nav'
import EditList from './components/EditList'
import NewList from './components/NewList'
import ViewList from './components/ViewList'

const Init = () => (
  <Router>
    <div>
      <Nav />
      <Route exact path="/" component={MainView} />
      <Route path="/edit/:id" component={EditList} />
      <Route path="/view/:id" component={ViewList} />
      <Route path="/new" component={NewList} />
    </div>
  </Router>
)

document.addEventListener('DOMContentLoaded', () => {
  render(<Init />, document.getElementById('main'))
})
